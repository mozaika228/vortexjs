let nextMapId = 1;

export class HiddenClass {
  constructor(properties = [], transitions = new Map()) {
    this.id = nextMapId++;
    this.properties = properties;
    this.transitions = transitions;
    this.slotByName = new Map(properties.map((name, index) => [name, index]));
  }

  getSlot(name) {
    return this.slotByName.get(name);
  }

  transition(name) {
    if (this.transitions.has(name)) {
      return this.transitions.get(name);
    }
    const next = new HiddenClass([...this.properties, name]);
    this.transitions.set(name, next);
    return next;
  }
}

export const EMPTY_HIDDEN_CLASS = new HiddenClass();
