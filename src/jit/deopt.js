export function buildDeoptMetadata(fn) {
  const metadata = new Map();
  for (let pc = 0; pc < fn.code.length; pc += 1) {
    metadata.set(pc, {
      id: pc,
      pc,
      liveRegisters: Array.from({ length: fn.registerCount }, (_, i) => i),
      reason: "guard-failed"
    });
  }
  return metadata;
}

export function materializeFrame(deoptError, fn, fallback) {
  const info = deoptError.deoptInfo ?? {};
  const pc = info.pc ?? fallback.pc ?? 0;
  const registers = info.registers ? [...info.registers] : [...(fallback.registers ?? [])];
  const args = info.args ? [...info.args] : [...(fallback.args ?? [])];
  const thisValue = info.thisValue ?? fallback.thisValue;

  const record = fn.deoptMetadata?.get(pc) ?? {
    id: pc,
    pc,
    liveRegisters: Array.from({ length: fn.registerCount }, (_, i) => i),
    reason: "materialized-fallback"
  };

  return {
    pc: record.pc,
    registers,
    thisValue,
    args,
    metadata: record
  };
}
