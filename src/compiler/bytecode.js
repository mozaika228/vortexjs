export const Op = {
  LOAD_CONST: "LOAD_CONST",
  LOAD_LOCAL: "LOAD_LOCAL",
  STORE_LOCAL: "STORE_LOCAL",
  LOAD_CAPTURE: "LOAD_CAPTURE",
  CREATE_OBJECT: "CREATE_OBJECT",
  LOAD_PROP: "LOAD_PROP",
  STORE_PROP: "STORE_PROP",
  ADD: "ADD",
  LESS_THAN: "LESS_THAN",
  JUMP: "JUMP",
  JUMP_IF_FALSE: "JUMP_IF_FALSE",
  CALL: "CALL",
  CREATE_CLOSURE: "CREATE_CLOSURE",
  RETURN: "RETURN"
};

export class BytecodeFunction {
  constructor({
    name,
    arity = 0,
    registerCount = 0,
    paramRegisters = [],
    captureRegisters = [],
    constants = [],
    code = []
  }) {
    this.name = name;
    this.arity = arity;
    this.registerCount = registerCount;
    this.paramRegisters = paramRegisters;
    this.captureRegisters = captureRegisters;
    this.constants = constants;
    this.code = code;
    this.hotness = 0;
    this.optimized = null;
  }
}
