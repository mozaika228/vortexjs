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
  constructor(heap, fn, context) {
    this.fn = fn;
    this.context = context;
    this.heapTag = heap.track(this, "closure");
  }

  references() {
    return [this.context];
  }
}
