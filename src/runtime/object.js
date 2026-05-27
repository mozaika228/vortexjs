import { EMPTY_HIDDEN_CLASS } from "./hidden-class.js";

let nextObjectId = 1;

export class PropertyDescriptor {
  constructor({
    value = undefined,
    writable = true,
    enumerable = true,
    configurable = true
  } = {}) {
    this.value = value;
    this.writable = writable;
    this.enumerable = enumerable;
    this.configurable = configurable;
  }
}

export class JSObject {
  constructor(heap, prototype = null) {
    this.id = nextObjectId++;
    this.map = EMPTY_HIDDEN_CLASS;
    this.storage = [];
    this.descriptors = new Map();
    this.prototype = prototype;
    this.heapTag = heap.track(this, "object");
  }

  setPrototype(prototype) {
    this.prototype = prototype;
  }

  getOwnDescriptor(name) {
    return this.descriptors.get(name);
  }

  defineDataProperty(name, descriptorOptions = {}) {
    let slot = this.map.getSlot(name);
    if (slot === undefined) {
      const nextMap = this.map.transition(name);
      slot = nextMap.getSlot(name);
      this.map = nextMap;
      this.storage.length = this.map.properties.length;
    }
    const descriptor = new PropertyDescriptor(descriptorOptions);
    this.descriptors.set(name, descriptor);
    this.storage[slot] = descriptor.value;
    return descriptor;
  }

  hasOwnProperty(name) {
    return this.map.getSlot(name) !== undefined;
  }

  getPropertyDescriptor(name) {
    if (this.hasOwnProperty(name)) {
      return this.getOwnDescriptor(name);
    }
    return this.prototype?.getPropertyDescriptor(name) ?? undefined;
  }

  load(name) {
    const ownSlot = this.map.getSlot(name);
    if (ownSlot !== undefined) {
      return this.storage[ownSlot];
    }
    return this.prototype?.load(name);
  }

  store(name, value) {
    const ownSlot = this.map.getSlot(name);
    if (ownSlot !== undefined) {
      const desc = this.descriptors.get(name);
      if (!desc?.writable) {
        return false;
      }
      this.storage[ownSlot] = value;
      desc.value = value;
      return true;
    }
    this.defineDataProperty(name, { value, writable: true, enumerable: true, configurable: true });
    return true;
  }

  references() {
    const refs = [];
    if (this.prototype && typeof this.prototype === "object") {
      refs.push(this.prototype);
    }
    for (const value of this.storage) {
      if (value && typeof value === "object") {
        refs.push(value);
      }
    }
    return refs;
  }
}
