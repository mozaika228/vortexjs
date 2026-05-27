export const Op = {
  LOAD_CONST: "LOAD_CONST",
  LOAD_LOCAL: "LOAD_LOCAL",
  STORE_LOCAL: "STORE_LOCAL",
  LOAD_CAPTURE: "LOAD_CAPTURE",
  LOAD_THIS: "LOAD_THIS",
  CREATE_OBJECT: "CREATE_OBJECT",
  CREATE_ARRAY: "CREATE_ARRAY",
  CREATE_OBJECT_WITH_PROTO: "CREATE_OBJECT_WITH_PROTO",
  LOAD_PROP: "LOAD_PROP",
  STORE_PROP: "STORE_PROP",
  LOAD_ELEM: "LOAD_ELEM",
  STORE_ELEM: "STORE_ELEM",
  DEFINE_DATA_PROP: "DEFINE_DATA_PROP",
  ADD: "ADD",
  LESS_THAN: "LESS_THAN",
  JUMP: "JUMP",
  JUMP_IF_FALSE: "JUMP_IF_FALSE",
  CALL: "CALL",
  CALL_METHOD: "CALL_METHOD",
  NEW: "NEW",
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
