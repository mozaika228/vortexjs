import { EMPTY_HIDDEN_CLASS } from "./hidden-class.js";

let nextObjectId = 1;

export class JSObject {
  constructor(heap) {
    this.id = nextObjectId++;
    this.map = EMPTY_HIDDEN_CLASS;
    this.storage = [];
    this.heapTag = heap.track(this, "object");
  }

  load(name) {
    const slot = this.map.getSlot(name);
    return slot === undefined ? undefined : this.storage[slot];
  }

  store(name, value) {
    let slot = this.map.getSlot(name);
    if (slot === undefined) {
      const nextMap = this.map.transition(name);
      slot = nextMap.getSlot(name);
      this.map = nextMap;
      this.storage.length = this.map.properties.length;
    }
    this.storage[slot] = value;
  }

  references() {
    return this.storage.filter((value) => value && typeof value === "object");
  }
}
