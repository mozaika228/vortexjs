const GP_REGS = ["rax", "rcx", "rdx", "r8", "r9", "r10"];

function computeIntervals(ir) {
  const intervals = new Map();
  const positionById = new Map(ir.insts.map((inst, idx) => [inst.id, idx]));

  for (const inst of ir.insts) {
    if (!intervals.has(inst.id)) {
      intervals.set(inst.id, { id: inst.id, start: positionById.get(inst.id), end: positionById.get(inst.id) });
    }
  }
  for (const inst of ir.insts) {
    const pos = positionById.get(inst.id);
    for (const arg of inst.args) {
      if (!intervals.has(arg)) {
        continue;
      }
      const it = intervals.get(arg);
      it.end = Math.max(it.end, pos);
    }
  }

  return [...intervals.values()].sort((a, b) => a.start - b.start);
}

export function allocateRegisters(ir) {
  const intervals = computeIntervals(ir);
  const active = [];
  const assignment = new Map();
  let spillCount = 0;

  const expireOld = (start) => {
    active.sort((a, b) => a.end - b.end);
    while (active.length > 0 && active[0].end < start) {
      active.shift();
    }
  };

  const usedRegs = () => new Set(active.filter((it) => assignment.get(it.id)?.kind === "reg").map((it) => assignment.get(it.id).reg));

  for (const it of intervals) {
    expireOld(it.start);
    const inUse = usedRegs();
    const free = GP_REGS.find((r) => !inUse.has(r));
    if (free) {
      assignment.set(it.id, { kind: "reg", reg: free });
      active.push(it);
      continue;
    }
    const worst = [...active].sort((a, b) => b.end - a.end)[0];
    if (worst && worst.end > it.end) {
      const worstAlloc = assignment.get(worst.id);
      assignment.set(it.id, worstAlloc);
      assignment.set(worst.id, { kind: "spill", slot: spillCount++ });
      const idx = active.findIndex((x) => x.id === worst.id);
      active.splice(idx, 1, it);
    } else {
      assignment.set(it.id, { kind: "spill", slot: spillCount++ });
    }
  }

  return {
    assignment,
    spillCount,
    registersUsed: [...new Set([...assignment.values()].filter((a) => a.kind === "reg").map((a) => a.reg))]
  };
}

function regCode(reg) {
  switch (reg) {
    case "rax":
      return 0;
    case "rcx":
      return 1;
    case "rdx":
      return 2;
    case "r8":
      return 0;
    case "r9":
      return 1;
    case "r10":
      return 2;
    default:
      return 0;
  }
}

function rexFor(regA, regB = null) {
  const highA = regA === "r8" || regA === "r9" || regA === "r10";
  const highB = regB === "r8" || regB === "r9" || regB === "r10";
  return 0x48 | (highA ? 0x01 : 0) | (highB ? 0x04 : 0);
}

class Emitter {
  constructor() {
    this.bytes = [];
  }

  emit(...vals) {
    this.bytes.push(...vals.map((v) => v & 0xff));
  }

  movRegImm32(reg, imm) {
    const opcodeBase = 0xb8 + regCode(reg);
    this.emit(rexFor(reg), opcodeBase, imm & 0xff, (imm >> 8) & 0xff, (imm >> 16) & 0xff, (imm >> 24) & 0xff);
  }

  movRegReg(dst, src) {
    this.emit(rexFor(src, dst), 0x89, 0xc0 | (regCode(src) << 3) | regCode(dst));
  }

  addRegReg(dst, src) {
    this.emit(rexFor(src, dst), 0x01, 0xc0 | (regCode(src) << 3) | regCode(dst));
  }

  cmpRegReg(a, b) {
    this.emit(rexFor(b, a), 0x39, 0xc0 | (regCode(b) << 3) | regCode(a));
  }

  setlAl() {
    this.emit(0x0f, 0x9c, 0xc0);
  }

  movzxRaxAl() {
    this.emit(0x48, 0x0f, 0xb6, 0xc0);
  }

  ret() {
    this.emit(0xc3);
  }

  toUint8Array() {
    return Uint8Array.from(this.bytes);
  }
}

function loadToReg(instId, alloc, emitter, fallbackReg, constValues) {
  const loc = alloc.assignment.get(instId);
  if (!loc) {
    return fallbackReg;
  }
  if (loc.kind === "reg") {
    return loc.reg;
  }
  const v = constValues.get(instId) ?? 0;
  emitter.movRegImm32(fallbackReg, Number(v) | 0);
  return fallbackReg;
}

export function generateX64MachineCode(ir, alloc) {
  const emitter = new Emitter();
  const constValues = new Map();

  for (const inst of ir.insts) {
    if (inst.op === "Const") {
      constValues.set(inst.id, inst.value);
      const loc = alloc.assignment.get(inst.id);
      if (loc?.kind === "reg") {
        emitter.movRegImm32(loc.reg, Number(inst.value) | 0);
      }
      continue;
    }
    if (inst.op === "Move") {
      const srcReg = loadToReg(inst.args[0], alloc, emitter, "rax", constValues);
      const dst = alloc.assignment.get(inst.id);
      if (dst?.kind === "reg") {
        emitter.movRegReg(dst.reg, srcReg);
      }
      continue;
    }
    if (inst.op === "Add") {
      const leftReg = loadToReg(inst.args[0], alloc, emitter, "rax", constValues);
      const rightReg = loadToReg(inst.args[1], alloc, emitter, "rcx", constValues);
      const dst = alloc.assignment.get(inst.id);
      if (dst?.kind === "reg") {
        emitter.movRegReg(dst.reg, leftReg);
        emitter.addRegReg(dst.reg, rightReg);
      }
      continue;
    }
    if (inst.op === "LessThan") {
      const leftReg = loadToReg(inst.args[0], alloc, emitter, "rax", constValues);
      const rightReg = loadToReg(inst.args[1], alloc, emitter, "rcx", constValues);
      emitter.cmpRegReg(leftReg, rightReg);
      emitter.setlAl();
      emitter.movzxRaxAl();
      const dst = alloc.assignment.get(inst.id);
      if (dst?.kind === "reg" && dst.reg !== "rax") {
        emitter.movRegReg(dst.reg, "rax");
      }
      continue;
    }
    if (inst.op === "Return") {
      const srcReg = loadToReg(inst.args[0], alloc, emitter, "rax", constValues);
      if (srcReg !== "rax") {
        emitter.movRegReg("rax", srcReg);
      }
      emitter.ret();
      break;
    }
  }

  if (emitter.bytes.length === 0 || emitter.bytes[emitter.bytes.length - 1] !== 0xc3) {
    emitter.ret();
  }

  const machineCode = emitter.toUint8Array();
  return {
    machineCode,
    hex: [...machineCode].map((b) => b.toString(16).padStart(2, "0")).join(""),
    size: machineCode.length
  };
}
