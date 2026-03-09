import { BytecodeFunction, Op } from "../compiler/bytecode.js";
import { ClosureValue, ExecutionContext } from "../runtime/context.js";
import { Heap } from "../runtime/heap.js";
import { JSObject } from "../runtime/object.js";
import { OptimizingJIT, DeoptError } from "../jit/compiler.js";
import { FeedbackVector } from "./feedback.js";
import { InlineCache } from "./ic.js";

export class VM {
  constructor() {
    this.heap = new Heap();
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
    return new ClosureValue(this.heap, fn, new ExecutionContext(this.heap, []));
  }

  createObjectFromEntries(entries) {
    const object = new JSObject(this.heap);
    for (const [name, value] of entries) {
      object.store(name, value);
      this.heap.writeBarrier(value);
    }
    return object;
  }

  invoke(closure, args = []) {
    const fn = closure.fn;
    fn.hotness += 1;
    const feedbackVector = this.feedback.get(fn);
    this.jit.maybeCompile(fn, feedbackVector, this);
    if (fn.optimized) {
      try {
        return fn.optimized.execute(this, closure, args);
      } catch (error) {
        if (!(error instanceof DeoptError)) {
          throw error;
        }
        feedbackVector.recordDeopt(error.pc);
        this.logs.push(`deopt ${fn.name}: ${error.message}`);
      }
    }
    return this.interpret(this, closure, args, { optimized: false });
  }

  interpret(vm, closure, args, { guardFn = () => {}, optimized }) {
    const fn = closure.fn;
    const feedbackVector = this.feedback.get(fn);
    const registers = new Array(fn.registerCount).fill(undefined);
    for (let i = 0; i < fn.paramRegisters.length; i += 1) {
      registers[fn.paramRegisters[i]] = args[i];
    }
    const captured = fn.captureRegisters.map((registerIndex) => registers[registerIndex]);
    const frameContext = new ExecutionContext(this.heap, captured);
    const frame = { fn, closure, registers, context: frameContext, pc: 0 };
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
        case Op.CREATE_OBJECT:
          registers[instruction.dst] = new JSObject(this.heap);
          break;
        case Op.LOAD_PROP: {
          const receiver = registers[instruction.obj];
          guardFn(pc, receiver);
          const hitSlot = receiver?.map ? cache.tryGet(receiver.map.id, instruction.name) : undefined;
          const value = hitSlot !== undefined ? receiver.storage[hitSlot] : receiver.load(instruction.name);
          if (receiver?.map) {
            cache.update(receiver.map.id, instruction.name, receiver.map.getSlot(instruction.name));
            feedbackVector.record(pc, receiver);
          }
          registers[instruction.dst] = value;
          break;
        }
        case Op.STORE_PROP: {
          const receiver = registers[instruction.obj];
          const value = registers[instruction.src];
          receiver.store(instruction.name, value);
          this.heap.writeBarrier(value);
          cache.update(receiver.map.id, instruction.name, receiver.map.getSlot(instruction.name));
          feedbackVector.record(pc, receiver);
          break;
        }
        case Op.ADD: {
          const left = registers[instruction.left];
          const right = registers[instruction.right];
          feedbackVector.record(pc, left);
          feedbackVector.record(pc, right);
          registers[instruction.dst] = left + right;
          break;
        }
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
        case Op.RETURN: {
          const result = registers[instruction.src];
          this.stack.pop();
          this.heap.maybeCollect(this.roots());
          this.logs.push(`${optimized ? "opt" : "interp"} return ${fn.name}`);
          return result;
        }
        default:
          throw new Error(`Unknown opcode ${instruction.op}`);
      }
      frame.pc += 1;
    }

    this.stack.pop();
    return undefined;
  }

  roots() {
    const roots = [];
    for (const frame of this.stack) {
      roots.push(frame.context, ...frame.registers);
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
        optimized: Boolean(fn.optimized),
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
      jit: this.jit.logs,
      vm: this.logs,
      gc: this.heap.logs
    };
  }
}

export function buildDemoProgram() {
  const makeAdder = new BytecodeFunction({
    name: "makeAdder",
    arity: 1,
    registerCount: 3,
    paramRegisters: [0],
    constants: [],
    code: [
      { op: Op.CREATE_CLOSURE, dst: 1, name: "adder", capture: [0] },
      { op: Op.RETURN, src: 1 }
    ]
  });

  const adder = new BytecodeFunction({
    name: "adder",
    arity: 1,
    registerCount: 3,
    paramRegisters: [0],
    constants: [],
    code: [
      { op: Op.LOAD_CAPTURE, dst: 1, index: 0 },
      { op: Op.ADD, dst: 2, left: 1, right: 0 },
      { op: Op.RETURN, src: 2 }
    ]
  });

  const main = new BytecodeFunction({
    name: "main",
    arity: 0,
    registerCount: 12,
    constants: [40, 2, 0, 5, "value", 1],
    code: [
      { op: Op.LOAD_CONST, dst: 0, index: 0 },
      { op: Op.LOAD_CONST, dst: 1, index: 1 },
      { op: Op.CREATE_OBJECT, dst: 2 },
      { op: Op.STORE_PROP, obj: 2, name: "x", src: 0 },
      { op: Op.STORE_PROP, obj: 2, name: "y", src: 1 },
      { op: Op.LOAD_PROP, dst: 3, obj: 2, name: "x" },
      { op: Op.LOAD_PROP, dst: 4, obj: 2, name: "y" },
      { op: Op.ADD, dst: 5, left: 3, right: 4 },
      { op: Op.CREATE_CLOSURE, dst: 6, name: "makeAdder", capture: [] },
      { op: Op.CALL, dst: 7, callee: 6, args: [5] },
      { op: Op.CALL, dst: 8, callee: 7, args: [1] },
      { op: Op.RETURN, src: 8 }
    ]
  });

  const sumXY = new BytecodeFunction({
    name: "sumXY",
    arity: 1,
    registerCount: 4,
    paramRegisters: [0],
    constants: [],
    code: [
      { op: Op.LOAD_PROP, dst: 1, obj: 0, name: "x" },
      { op: Op.LOAD_PROP, dst: 2, obj: 0, name: "y" },
      { op: Op.ADD, dst: 3, left: 1, right: 2 },
      { op: Op.RETURN, src: 3 }
    ]
  });

  return [main, makeAdder, adder, sumXY];
}
