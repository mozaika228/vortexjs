import { Op } from "../compiler/bytecode.js";
import { ClosureValue, ExecutionContext } from "../runtime/context.js";
import { Heap } from "../runtime/heap.js";
import { JSObject } from "../runtime/object.js";
import { JSArray } from "../runtime/array.js";
import { OptimizingJIT, DeoptError } from "../jit/compiler.js";
import { BaselineCompiler } from "../jit/baseline.js";
import { FeedbackVector } from "./feedback.js";
import { InlineCache } from "./ic.js";

export class VM {
  constructor() {
    this.heap = new Heap();
    this.baseline = new BaselineCompiler();
    this.jit = new OptimizingJIT();
    this.feedback = new Map();
    this.inlineCaches = new Map();
    this.stack = [];
    this.logs = [];
    this.program = new Map();
  }

  registerFunctions(functions) {
    for (const fn of functions) {
      this.program.set(fn.name, fn);
      this.feedback.set(fn, new FeedbackVector());
    }
  }

  createTopLevelClosure(name) {
    const fn = this.program.get(name);
    if (!fn) {
      throw new Error(`Function '${name}' not found`);
    }
    return new ClosureValue(this.heap, fn, new ExecutionContext(this.heap, []));
  }

  createObjectFromEntries(entries, prototype = null) {
    const object = new JSObject(this.heap, prototype);
    for (const [name, value] of entries) {
      object.defineDataProperty(name, { value, writable: true, enumerable: true, configurable: true });
      this.heap.writeBarrier(value);
    }
    return object;
  }

  invoke(closure, args = [], options = {}) {
    if (closure && typeof closure === "object" && typeof closure.__hostCall === "function") {
      return closure.__hostCall(args, options.thisValue, options.isConstruct);
    }
    const { thisValue = undefined, isConstruct = false } = options;
    const fn = closure.fn;
    fn.hotness += 1;
    const feedbackVector = this.feedback.get(fn);
    this.baseline.maybeCompile(fn, this);
    this.jit.maybeCompile(fn, feedbackVector, this);
    if (fn.optimized) {
      try {
        return fn.optimized.execute(this, closure, args, thisValue, isConstruct);
      } catch (error) {
        if (!(error instanceof DeoptError)) {
          throw error;
        }
        feedbackVector.recordDeopt(error.pc);
        this.logs.push(`deopt ${fn.name}: ${error.message}`);
      }
    }
    if (fn.baseline) {
      return fn.baseline.execute(closure, args, thisValue, isConstruct);
    }
    return this.interpret(closure, args, { tier: "interp", thisValue, isConstruct });
  }

  interpret(closure, args, { guardFn = () => {}, tier = "interp", thisValue, isConstruct }) {
    const fn = closure.fn;
    const feedbackVector = this.feedback.get(fn);
    const registers = new Array(fn.registerCount).fill(undefined);
    for (let i = 0; i < fn.paramRegisters.length; i += 1) {
      registers[fn.paramRegisters[i]] = args[i];
    }
    const frame = {
      fn,
      closure,
      registers,
      context: new ExecutionContext(this.heap, []),
      thisValue,
      pc: 0,
      isConstruct
    };
    this.stack.push(frame);

    while (frame.pc < fn.code.length) {
      const instruction = fn.code[frame.pc];
      const pc = frame.pc;
      const cache = this.getInlineCache(fn, pc, instruction.op);

      switch (instruction.op) {
        case Op.LOAD_CONST:
          registers[instruction.dst] = fn.constants[instruction.index];
          break;
        case Op.LOAD_LOCAL:
          registers[instruction.dst] = registers[instruction.src];
          break;
        case Op.STORE_LOCAL:
          registers[instruction.dst] = registers[instruction.src];
          break;
        case Op.LOAD_CAPTURE:
          registers[instruction.dst] = closure.context.get(instruction.index);
          break;
        case Op.LOAD_THIS:
          registers[instruction.dst] = frame.thisValue;
          break;
        case Op.CREATE_OBJECT:
          registers[instruction.dst] = new JSObject(this.heap, null);
          break;
        case Op.CREATE_ARRAY:
          registers[instruction.dst] = new JSArray(this.heap, []);
          break;
        case Op.CREATE_OBJECT_WITH_PROTO:
          registers[instruction.dst] = new JSObject(this.heap, registers[instruction.proto] ?? null);
          break;
        case Op.DEFINE_DATA_PROP: {
          const receiver = registers[instruction.obj];
          const value = registers[instruction.src];
          receiver.defineDataProperty(instruction.name, {
            value,
            writable: instruction.writable,
            enumerable: instruction.enumerable,
            configurable: instruction.configurable
          });
          this.heap.writeBarrier(value);
          break;
        }
        case Op.LOAD_PROP: {
          const receiver = registers[instruction.obj];
          guardFn(pc, receiver);
          const hitSlot = receiver?.map ? cache.tryGet(receiver.map.id, instruction.name) : undefined;
          const value = hitSlot !== undefined ? receiver.storage[hitSlot] : receiver?.load?.(instruction.name);
          if (receiver?.map) {
            cache.update(receiver.map.id, instruction.name, receiver.map.getSlot(instruction.name));
            feedbackVector.record(pc, receiver);
          }
          registers[instruction.dst] = value;
          break;
        }
        case Op.LOAD_ELEM: {
          const receiver = registers[instruction.obj];
          const index = registers[instruction.index];
          if (receiver instanceof JSArray && Number.isInteger(index) && index >= 0) {
            registers[instruction.dst] = receiver.getElement(index);
            feedbackVector.record(pc, receiver);
          } else {
            registers[instruction.dst] = receiver?.load?.(String(index));
          }
          break;
        }
        case Op.STORE_PROP: {
          const receiver = registers[instruction.obj];
          const value = registers[instruction.src];
          receiver.store(instruction.name, value);
          this.heap.writeBarrier(value);
          if (receiver?.map) {
            cache.update(receiver.map.id, instruction.name, receiver.map.getSlot(instruction.name));
            feedbackVector.record(pc, receiver);
          }
          break;
        }
        case Op.STORE_ELEM: {
          const receiver = registers[instruction.obj];
          const index = registers[instruction.index];
          const value = registers[instruction.src];
          if (receiver instanceof JSArray && Number.isInteger(index) && index >= 0) {
            if (instruction.isHole && index > receiver.length) {
              receiver.transitionToHoley();
            }
            receiver.setElement(index, value);
            feedbackVector.record(pc, receiver);
          } else {
            receiver.store(String(index), value);
          }
          this.heap.writeBarrier(value);
          break;
        }
        case Op.ADD:
          feedbackVector.record(pc, registers[instruction.left]);
          feedbackVector.record(pc, registers[instruction.right]);
          registers[instruction.dst] = registers[instruction.left] + registers[instruction.right];
          break;
        case Op.LESS_THAN:
          registers[instruction.dst] = registers[instruction.left] < registers[instruction.right];
          break;
        case Op.JUMP:
          frame.pc = instruction.target;
          continue;
        case Op.JUMP_IF_FALSE:
          if (!registers[instruction.cond]) {
            frame.pc = instruction.target;
            continue;
          }
          break;
        case Op.CREATE_CLOSURE: {
          const targetFn = this.program.get(instruction.name);
          if (!targetFn) {
            throw new Error(`Function '${instruction.name}' not found`);
          }
          const slots = instruction.capture.map((registerIndex) => registers[registerIndex]);
          const context = new ExecutionContext(this.heap, slots);
          registers[instruction.dst] = new ClosureValue(this.heap, targetFn, context);
          break;
        }
        case Op.CALL: {
          const target = registers[instruction.callee];
          const callArgs = instruction.args.map((registerIndex) => registers[registerIndex]);
          registers[instruction.dst] = this.invoke(target, callArgs);
          break;
        }
        case Op.CALL_METHOD: {
          const receiver = registers[instruction.obj];
          const method = receiver.load(instruction.name);
          const callArgs = instruction.args.map((registerIndex) => registers[registerIndex]);
          registers[instruction.dst] = this.invoke(method, callArgs, { thisValue: receiver });
          break;
        }
        case Op.NEW: {
          const target = registers[instruction.callee];
          const callArgs = instruction.args.map((registerIndex) => registers[registerIndex]);
          if (target && typeof target === "object" && typeof target.__hostConstruct === "function") {
            registers[instruction.dst] = target.__hostConstruct(callArgs);
            break;
          }
          const proto = target.prototypeObject ?? null;
          const instance = new JSObject(this.heap, proto);
          const returned = this.invoke(target, callArgs, { thisValue: instance, isConstruct: true });
          registers[instruction.dst] = returned && typeof returned === "object" ? returned : instance;
          break;
        }
        case Op.RETURN: {
          const result = registers[instruction.src];
          this.stack.pop();
          this.heap.maybeCollect(this.roots());
          this.logs.push(`${tier} return ${fn.name}`);
          if (frame.isConstruct && (result === undefined || result === null || typeof result !== "object")) {
            return frame.thisValue;
          }
          return result;
        }
        default:
          throw new Error(`Unknown opcode ${instruction.op}`);
      }
      frame.pc += 1;
    }

    this.stack.pop();
    return frame.isConstruct ? frame.thisValue : undefined;
  }

  roots() {
    const roots = [];
    for (const frame of this.stack) {
      roots.push(frame.context, frame.thisValue, ...frame.registers);
    }
    return roots;
  }

  getInlineCache(fn, pc, kind) {
    const key = `${fn.name}:${pc}`;
    if (!this.inlineCaches.has(key)) {
      this.inlineCaches.set(key, new InlineCache(kind, pc));
    }
    return this.inlineCaches.get(key);
  }

  report() {
    const functions = [];
    for (const fn of this.program.values()) {
      functions.push({
        name: fn.name,
        hotness: fn.hotness,
        baseline: Boolean(fn.baseline),
        optimized: Boolean(fn.optimized),
        optimizationReport: fn.optimizationReport ?? null,
        registerAllocation: fn.registerAllocation ?? null,
        x64Code: fn.x64Code ? { size: fn.x64Code.size, hex: fn.x64Code.hex } : null,
        feedback: this.feedback.get(fn).summarize()
      });
    }
    const inlineCaches = [...this.inlineCaches.entries()].map(([site, cache]) => ({
      site,
      state: cache.state,
      entries: cache.entries
    }));
    return {
      functions,
      inlineCaches,
      baseline: this.baseline.logs,
      jit: this.jit.logs,
      vm: this.logs,
      gc: this.heap.logs
    };
  }
}
