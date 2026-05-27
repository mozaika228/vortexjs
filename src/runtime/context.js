import { JSObject } from "./object.js";

let nextContextId = 1;

export class ExecutionContext {
  constructor(heap, slots = []) {
    this.id = nextContextId++;
    this.slots = [...slots];
    this.heapTag = heap.track(this, "context");
  }

  get(index) {
    return this.slots[index];
  }

  set(index, value) {
    this.slots[index] = value;
  }

  references() {
    return this.slots.filter((value) => value && typeof value === "object");
  }
}

export class ClosureValue {
  constructor(heap, fn, context, { name = fn.name, constructable = true } = {}) {
    this.name = name;
    this.fn = fn;
    this.context = context;
    this.constructable = constructable;
    this.objectShape = new JSObject(heap, null);
    this.prototypeObject = new JSObject(heap, null);
    this.objectShape.defineDataProperty("prototype", {
      value: this.prototypeObject,
      writable: false,
      enumerable: false,
      configurable: false
    });
    this.heapTag = heap.track(this, "closure");
  }

  get map() {
    return this.objectShape.map;
  }

  get storage() {
    return this.objectShape.storage;
  }

  defineDataProperty(name, descriptor) {
    const result = this.objectShape.defineDataProperty(name, descriptor);
    if (name === "prototype") {
      this.prototypeObject = descriptor.value;
    }
    return result;
  }

  load(name) {
    return this.objectShape.load(name);
  }

  store(name, value) {
    return this.objectShape.store(name, value);
  }

  references() {
    return [this.context, this.objectShape, this.prototypeObject];
  }
}
