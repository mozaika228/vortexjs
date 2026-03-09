function classify(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (value?.map?.id) {
    return `object(map:${value.map.id})`;
  }
  return typeof value;
}

export class FeedbackVector {
  constructor() {
    this.slots = new Map();
  }

  ensure(pc) {
    if (!this.slots.has(pc)) {
      this.slots.set(pc, {
        executions: 0,
        types: new Map(),
        maps: new Map(),
        deopts: 0
      });
    }
    return this.slots.get(pc);
  }

  record(pc, value) {
    const slot = this.ensure(pc);
    slot.executions += 1;
    const type = classify(value);
    slot.types.set(type, (slot.types.get(type) ?? 0) + 1);
    if (value?.map?.id) {
      slot.maps.set(value.map.id, (slot.maps.get(value.map.id) ?? 0) + 1);
    }
  }

  recordDeopt(pc) {
    const slot = this.ensure(pc);
    slot.deopts += 1;
  }

  summarize() {
    return [...this.slots.entries()].map(([pc, slot]) => ({
      pc,
      executions: slot.executions,
      deopts: slot.deopts,
      types: [...slot.types.entries()],
      maps: [...slot.maps.entries()]
    }));
  }
}
