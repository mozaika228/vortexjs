export class InlineCache {
  constructor(kind, pc) {
    this.kind = kind;
    this.pc = pc;
    this.state = "uninitialized";
    this.entries = [];
    this.maxPolymorphic = 4;
  }

  makeProtoGuard(receiver) {
    if (!receiver || typeof receiver.getPrototypeChainMapIds !== "function") {
      return [];
    }
    return receiver.getPrototypeChainMapIds();
  }

  guardMatches(entry, receiver) {
    const chain = this.makeProtoGuard(receiver);
    if (entry.protoGuards.length !== chain.length) {
      return false;
    }
    for (let i = 0; i < chain.length; i += 1) {
      if (chain[i] !== entry.protoGuards[i]) {
        return false;
      }
    }
    return true;
  }

  tryGetLoad(receiver, name) {
    const mapId = receiver?.map?.id;
    const hit = this.entries.find(
      (entry) =>
        entry.stub === "load" &&
        entry.mapId === mapId &&
        entry.name === name &&
        this.guardMatches(entry, receiver)
    );
    return hit ? { slot: hit.slot, fromPrototype: hit.fromPrototype } : null;
  }

  tryGetStore(receiver, name) {
    const mapId = receiver?.map?.id;
    const hit = this.entries.find(
      (entry) =>
        entry.stub === "store" &&
        entry.mapId === mapId &&
        entry.name === name &&
        this.guardMatches(entry, receiver)
    );
    return hit ? { slot: hit.slot } : null;
  }

  tryGetCall(receiver, name) {
    const mapId = receiver?.map?.id;
    const hit = this.entries.find(
      (entry) =>
        entry.stub === "call" &&
        entry.mapId === mapId &&
        entry.name === name &&
        this.guardMatches(entry, receiver)
    );
    return hit ? { method: hit.method } : null;
  }

  updateLoad(receiver, name, { slot, fromPrototype = false } = {}) {
    const mapId = receiver?.map?.id;
    if (mapId === undefined) {
      return;
    }
    this.update({
      stub: "load",
      mapId,
      name,
      slot,
      fromPrototype,
      protoGuards: this.makeProtoGuard(receiver)
    });
  }

  updateStore(receiver, name, { slot } = {}) {
    const mapId = receiver?.map?.id;
    if (mapId === undefined) {
      return;
    }
    this.update({
      stub: "store",
      mapId,
      name,
      slot,
      protoGuards: this.makeProtoGuard(receiver)
    });
  }

  updateCall(receiver, name, method) {
    const mapId = receiver?.map?.id;
    if (mapId === undefined) {
      return;
    }
    this.update({
      stub: "call",
      mapId,
      name,
      method,
      protoGuards: this.makeProtoGuard(receiver)
    });
  }

  update(entry) {
    if (this.entries.length === 0) {
      this.state = "monomorphic";
    } else if (
      !this.entries.find(
        (existing) =>
          existing.stub === entry.stub &&
          existing.mapId === entry.mapId &&
          existing.name === entry.name &&
          JSON.stringify(existing.protoGuards) === JSON.stringify(entry.protoGuards)
      )
    ) {
      this.state = this.entries.length === 1 ? "polymorphic" : "megamorphic";
    }
    if (
      !this.entries.find(
        (existing) =>
          existing.stub === entry.stub &&
          existing.mapId === entry.mapId &&
          existing.name === entry.name &&
          JSON.stringify(existing.protoGuards) === JSON.stringify(entry.protoGuards)
      )
    ) {
      this.entries.push(entry);
    }
    if (this.entries.length > this.maxPolymorphic) {
      this.entries = this.entries.slice(-this.maxPolymorphic);
      this.state = "megamorphic";
    }
  }
}
