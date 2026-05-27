import { JSObject } from "./object.js";

export const ElementsKind = {
  PACKED_SMI: "PACKED_SMI",
  PACKED_DOUBLE: "PACKED_DOUBLE",
  PACKED_OBJECT: "PACKED_OBJECT",
  HOLEY_SMI: "HOLEY_SMI",
  HOLEY_DOUBLE: "HOLEY_DOUBLE",
  HOLEY_OBJECT: "HOLEY_OBJECT"
};

function classifyValue(value) {
  if (Number.isInteger(value) && Number.isFinite(value)) {
    return "smi";
  }
  if (typeof value === "number") {
    return "double";
  }
  return "object";
}

function isHoleyKind(kind) {
  return kind.startsWith("HOLEY_");
}

function baseKind(kind) {
  if (kind.endsWith("_SMI")) {
    return "SMI";
  }
  if (kind.endsWith("_DOUBLE")) {
    return "DOUBLE";
  }
  return "OBJECT";
}

function makeKind(holey, base) {
  return `${holey ? "HOLEY" : "PACKED"}_${base}`;
}

export class JSArray extends JSObject {
  constructor(heap, initial = [], prototype = null) {
    super(heap, prototype);
    this.elements = [];
    this.length = 0;
    this.elementsKind = ElementsKind.PACKED_SMI;
    this.holey = false;
    for (const value of initial) {
      this.push(value);
    }
  }

  transitionKindForValue(valueType) {
    const currentBase = baseKind(this.elementsKind);
    let nextBase = currentBase;
    if (valueType === "object") {
      nextBase = "OBJECT";
    } else if (valueType === "double" && currentBase === "SMI") {
      nextBase = "DOUBLE";
    }
    this.elementsKind = makeKind(this.holey, nextBase);
  }

  transitionToHoley() {
    if (this.holey) {
      return;
    }
    this.holey = true;
    this.elementsKind = makeKind(true, baseKind(this.elementsKind));
  }

  setElement(index, value) {
    if (!Number.isInteger(index) || index < 0) {
      this.store(String(index), value);
      return;
    }
    const valueType = classifyValue(value);
    this.transitionKindForValue(valueType);
    if (index > this.length) {
      this.transitionToHoley();
    }
    this.elements[index] = value;
    this.length = Math.max(this.length, index + 1);
  }

  getElement(index) {
    if (!Number.isInteger(index) || index < 0) {
      return this.load(String(index));
    }
    if (index >= this.length) {
      return undefined;
    }
    return this.elements[index];
  }

  push(value) {
    this.setElement(this.length, value);
    return this.length;
  }

  load(name) {
    if (name === "length") {
      return this.length;
    }
    const numeric = Number(name);
    if (Number.isInteger(numeric) && String(numeric) === String(name)) {
      return this.getElement(numeric);
    }
    return super.load(name);
  }

  store(name, value) {
    if (name === "length") {
      const nextLength = Number(value);
      if (!Number.isInteger(nextLength) || nextLength < 0) {
        return false;
      }
      this.length = nextLength;
      this.elements.length = nextLength;
      return true;
    }
    const numeric = Number(name);
    if (Number.isInteger(numeric) && String(numeric) === String(name)) {
      this.setElement(numeric, value);
      return true;
    }
    return super.store(name, value);
  }

  references() {
    const refs = super.references();
    for (const element of this.elements) {
      if (element && typeof element === "object") {
        refs.push(element);
      }
    }
    return refs;
  }
}
