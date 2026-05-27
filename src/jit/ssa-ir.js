import { Op } from "../compiler/bytecode.js";

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function makeInst(id, op, args = [], meta = {}) {
  return { id, op, args, uses: 0, dead: false, loopDepth: 0, ...meta };
}

export function buildSSAIR(fn) {
  let nextId = 0;
  const insts = [];
  const regDef = new Map();

  const def = (reg, inst) => {
    regDef.set(reg, inst.id);
  };
  const use = (reg) => regDef.get(reg);

  for (let pc = 0; pc < fn.code.length; pc += 1) {
    const ins = fn.code[pc];
    switch (ins.op) {
      case Op.LOAD_CONST: {
        const node = makeInst(nextId++, "Const", [], { value: fn.constants[ins.index], pc, dst: ins.dst });
        insts.push(node);
        def(ins.dst, node);
        break;
      }
      case Op.LOAD_LOCAL: {
        const src = use(ins.src);
        const node = makeInst(nextId++, "Move", [src], { pc, dst: ins.dst, src: ins.src });
        insts.push(node);
        def(ins.dst, node);
        break;
      }
      case Op.LOAD_CAPTURE:
      case Op.LOAD_THIS: {
        const node = makeInst(nextId++, "LoadEnv", [], { pc, dst: ins.dst });
        insts.push(node);
        def(ins.dst, node);
        break;
      }
      case Op.ADD:
      case Op.LESS_THAN: {
        const lhs = use(ins.left);
        const rhs = use(ins.right);
        const op = ins.op === Op.ADD ? "Add" : "LessThan";
        const node = makeInst(nextId++, op, [lhs, rhs], { pc, dst: ins.dst });
        insts.push(node);
        def(ins.dst, node);
        break;
      }
      case Op.CREATE_CLOSURE: {
        const args = (ins.capture ?? []).map((reg) => use(reg));
        const node = makeInst(nextId++, "CreateClosure", args, {
          pc,
          dst: ins.dst,
          calleeName: ins.name
        });
        insts.push(node);
        def(ins.dst, node);
        break;
      }
      case Op.CALL: {
        const callee = use(ins.callee);
        const args = [callee, ...ins.args.map((reg) => use(reg))];
        const node = makeInst(nextId++, "Call", args, {
          pc,
          dst: ins.dst,
          argCount: ins.args.length,
          calleeReg: ins.callee
        });
        insts.push(node);
        def(ins.dst, node);
        break;
      }
      case Op.RETURN: {
        const src = use(ins.src);
        insts.push(makeInst(nextId++, "Return", [src], { pc }));
        break;
      }
      case Op.JUMP:
      case Op.JUMP_IF_FALSE:
        insts.push(makeInst(nextId++, ins.op === Op.JUMP ? "Jump" : "Branch", [], { pc, target: ins.target }));
        break;
      default:
        insts.push(makeInst(nextId++, `Effect:${ins.op}`, [], { pc }));
        break;
    }
  }

  return { fnName: fn.name, insts };
}

function computeUses(ir) {
  const byId = new Map(ir.insts.map((i) => [i.id, i]));
  for (const inst of ir.insts) {
    inst.uses = 0;
  }
  for (const inst of ir.insts) {
    for (const arg of inst.args) {
      if (arg === undefined) {
        continue;
      }
      const dep = byId.get(arg);
      if (dep) {
        dep.uses += 1;
      }
    }
  }
}

function constantFolding(ir) {
  let changed = 0;
  const byId = new Map(ir.insts.map((i) => [i.id, i]));
  for (const inst of ir.insts) {
    if (inst.op !== "Add" && inst.op !== "LessThan") {
      continue;
    }
    const [a, b] = inst.args.map((id) => byId.get(id));
    if (!a || !b || a.op !== "Const" || b.op !== "Const") {
      continue;
    }
    const value = inst.op === "Add" ? a.value + b.value : a.value < b.value;
    inst.op = "Const";
    inst.args = [];
    inst.value = value;
    changed += 1;
  }
  return changed;
}

function deadCodeElimination(ir) {
  computeUses(ir);
  let removed = 0;
  for (const inst of ir.insts) {
    const pure = inst.op === "Const" || inst.op === "Add" || inst.op === "LessThan" || inst.op === "Move";
    if (pure && inst.uses === 0) {
      inst.dead = true;
      removed += 1;
    }
  }
  ir.insts = ir.insts.filter((i) => !i.dead);
  return removed;
}

function globalValueNumbering(ir) {
  const table = new Map();
  const replace = new Map();
  let merged = 0;

  for (const inst of ir.insts) {
    if (!["Const", "Add", "LessThan", "Move"].includes(inst.op)) {
      continue;
    }
    const key = `${inst.op}|${inst.value ?? ""}|${inst.args.join(",")}`;
    if (table.has(key)) {
      replace.set(inst.id, table.get(key));
      inst.dead = true;
      merged += 1;
    } else {
      table.set(key, inst.id);
    }
  }

  for (const inst of ir.insts) {
    inst.args = inst.args.map((arg) => (replace.has(arg) ? replace.get(arg) : arg));
  }
  ir.insts = ir.insts.filter((i) => !i.dead);
  return merged;
}

function loopInvariantCodeMotion(ir) {
  const loopEntries = new Set();
  for (const inst of ir.insts) {
    if (inst.op === "Jump" && typeof inst.target === "number" && inst.target < inst.pc) {
      loopEntries.add(inst.target);
    }
  }
  if (loopEntries.size === 0) {
    return 0;
  }

  let moved = 0;
  for (const inst of ir.insts) {
    if (!["Const", "Add", "LessThan", "Move"].includes(inst.op)) {
      continue;
    }
    for (const head of loopEntries) {
      if (inst.pc > head) {
        inst.loopDepth = 1;
      }
    }
  }

  const hoistable = ir.insts.filter((i) => i.loopDepth > 0 && ["Const", "Move"].includes(i.op));
  if (hoistable.length === 0) {
    return 0;
  }

  ir.insts = [...hoistable, ...ir.insts.filter((i) => !hoistable.includes(i))];
  moved = hoistable.length;
  return moved;
}

function inlining(ir, fn) {
  let inlined = 0;
  for (const inst of ir.insts) {
    if (inst.op !== "Call") {
      continue;
    }
    const calleeDefId = inst.args[0];
    const calleeDef = ir.insts.find((i) => i.id === calleeDefId);
    if (!calleeDef || calleeDef.op !== "CreateClosure" || !calleeDef.calleeName) {
      continue;
    }
    if (calleeDef.calleeName === fn.name) {
      continue;
    }
    inst.op = "InlinedCall";
    inst.inlinedFrom = calleeDef.calleeName;
    inlined += 1;
  }
  return inlined;
}

export function optimizeSSAIR(ir, fn) {
  const work = clone(ir);
  const stats = {
    constantFolding: constantFolding(work),
    gvn: globalValueNumbering(work),
    dce: deadCodeElimination(work),
    licm: loopInvariantCodeMotion(work),
    inlining: inlining(work, fn)
  };
  return { ir: work, stats };
}
