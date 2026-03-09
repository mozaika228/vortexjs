export class InlineCache {
  constructor(kind, pc) {
    this.kind = kind;
    this.pc = pc;
    this.state = "uninitialized";
    this.entries = [];
  }

  tryGet(mapId, name) {
    const hit = this.entries.find((entry) => entry.mapId === mapId && entry.name === name);
    return hit?.slot;
  }

  update(mapId, name, slot) {
    if (this.entries.length === 0) {
      this.state = "monomorphic";
    } else if (!this.entries.find((entry) => entry.mapId === mapId && entry.name === name)) {
      this.state = this.entries.length === 1 ? "polymorphic" : "megamorphic";
    }
    if (!this.entries.find((entry) => entry.mapId === mapId && entry.name === name)) {
      this.entries.push({ mapId, name, slot });
    }
    if (this.entries.length > 4) {
      this.entries = this.entries.slice(-4);
      this.state = "megamorphic";
    }
  }
}
