import { BytecodeFunction, Op } from "../bytecode.js";

class FunctionLowerer {
  constructor(info, scopes) {
    this.info = info;
    this.scopes = scopes;
    this.code = [];
    this.constants = [];
    this.constantIndex = new Map();
    this.nextRegister = 0;
    this.paramRegisters = [];
    this.localByName = new Map();
    this.captureOrder = [...info.captures];
  }

  lower() {
    for (const param of this.info.node.params) {
      const reg = this.allocateRegister();
      this.localByName.set(param.name, reg);
      this.paramRegisters.push(reg);
    }
    for (const local of this.info.locals) {
      if (!this.localByName.has(local)) {
        this.localByName.set(local, this.allocateRegister());
      }
    }
    for (let i = 0; i < this.captureOrder.length; i += 1) {
      const name = this.captureOrder[i];
      if (!this.localByName.has(name)) {
        const reg = this.allocateRegister();
        this.localByName.set(name, reg);
        this.emit({ op: Op.LOAD_CAPTURE, dst: reg, index: i });
      }
    }

    for (const statement of this.info.node.body.body) {
      if (statement.type === "FunctionDeclaration") {
        this.emitFunctionBinding(statement, statement.id.name);
      } else if (statement.type === "ClassDeclaration") {
        this.emitClassBinding(statement);
      } else if (statement.type === "ExportNamedDeclaration") {
        const decl = statement.declaration;
        if (decl.type === "FunctionDeclaration") {
          this.emitFunctionBinding(decl, decl.id.name);
          this.emitExport(decl);
        } else if (decl.type === "ClassDeclaration") {
          this.emitClassBinding(decl);
          this.emitExport(decl);
        }
      }
    }

    for (const statement of this.info.node.body.body) {
      if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
        continue;
      }
      if (statement.type === "ExportNamedDeclaration") {
        if (statement.declaration.type === "FunctionDeclaration" || statement.declaration.type === "ClassDeclaration") {
          continue;
        }
      }
      this.lowerStatement(statement);
    }

    if (this.code.length === 0 || this.code[this.code.length - 1].op !== Op.RETURN) {
      const undefReg = this.emitLoadConst(undefined);
      this.emit({ op: Op.RETURN, src: undefReg });
    }

    return new BytecodeFunction({
      name: this.info.name,
      arity: this.info.node.params.length,
      registerCount: this.nextRegister,
      paramRegisters: this.paramRegisters,
      captureRegisters: [],
      constants: this.constants,
      code: this.code
    });
  }

  emitFunctionBinding(fnNode, localName) {
    const childInfo = this.scopes.byNode.get(fnNode);
    const dst = this.getLocal(localName);
    const captureRegs = [...childInfo.captures].map((name) => this.getLocal(name));
    this.emit({ op: Op.CREATE_CLOSURE, dst, name: childInfo.name, capture: captureRegs });
  }

  emitClassBinding(classNode) {
    const classLocal = this.getLocal(classNode.id.name);
    const constructorMethod = classNode.body.body.find((m) => m.kind === "constructor");
    const ctorName = constructorMethod
      ? `${classNode.id.name}::constructor`
      : `${classNode.id.name}::constructor_default`;

    this.emit({ op: Op.CREATE_CLOSURE, dst: classLocal, name: ctorName, capture: [] });
    const protoReg = this.allocateRegister();
    this.emit({ op: Op.CREATE_OBJECT, dst: protoReg });
    this.emit({ op: Op.DEFINE_DATA_PROP, obj: classLocal, name: "prototype", src: protoReg, writable: false, enumerable: false, configurable: false });

    for (const method of classNode.body.body) {
      if (method.kind === "constructor") {
        continue;
      }
      const methodFnName = `${classNode.id.name}::${method.key.name}`;
      const methodReg = this.allocateRegister();
      this.emit({ op: Op.CREATE_CLOSURE, dst: methodReg, name: methodFnName, capture: [] });
      this.emit({ op: Op.DEFINE_DATA_PROP, obj: protoReg, name: method.key.name, src: methodReg, writable: true, enumerable: false, configurable: true });
    }
  }

  lowerStatement(statement) {
    switch (statement.type) {
      case "ImportDeclaration":
        for (const spec of statement.specifiers) {
          const moduleNameReg = this.emitLoadConst(statement.source.value);
          const importNameReg = this.emitLoadConst(spec.imported.name);
          const globalGet = this.getLocal("__vortex_import__");
          const dst = this.getLocal(spec.local.name);
          this.emit({ op: Op.CALL, dst, callee: globalGet, args: [moduleNameReg, importNameReg] });
        }
        return;
      case "ExportNamedDeclaration":
        this.lowerStatement(statement.declaration);
        this.emitExport(statement.declaration);
        return;
      case "VariableDeclaration":
        for (const decl of statement.declarations) {
          if (!decl.init) {
            continue;
          }
          const initReg = this.lowerExpression(decl.init);
          this.emit({ op: Op.STORE_LOCAL, dst: this.getLocal(decl.id.name), src: initReg });
        }
        return;
      case "ReturnStatement": {
        const valueReg = statement.argument ? this.lowerExpression(statement.argument) : this.emitLoadConst(undefined);
        this.emit({ op: Op.RETURN, src: valueReg });
        return;
      }
      case "ExpressionStatement":
        this.lowerExpression(statement.expression);
        return;
      case "IfStatement":
        this.lowerIf(statement);
        return;
      case "WhileStatement":
        this.lowerWhile(statement);
        return;
      case "BlockStatement":
        for (const nested of statement.body) {
          this.lowerStatement(nested);
        }
        return;
      default:
        throw new Error(`Unsupported statement in lowering: ${statement.type}`);
    }
  }

  emitExport(declaration) {
    let name = null;
    if (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") {
      name = declaration.id.name;
    } else if (declaration.type === "VariableDeclaration") {
      for (const decl of declaration.declarations) {
        this.emitExport({ type: "SyntheticVarExport", id: decl.id });
      }
      return;
    } else if (declaration.type === "SyntheticVarExport") {
      name = declaration.id.name;
    }
    if (!name) {
      return;
    }
    const exportFn = this.getLocal("__vortex_export__");
    const moduleReg = this.emitLoadConst("__current__");
    const nameReg = this.emitLoadConst(name);
    const valueReg = this.getLocal(name);
    const sink = this.allocateRegister();
    this.emit({ op: Op.CALL, dst: sink, callee: exportFn, args: [moduleReg, nameReg, valueReg] });
  }

  lowerIf(statement) {
    const cond = this.lowerExpression(statement.test);
    const jmpFalse = this.emit({ op: Op.JUMP_IF_FALSE, cond, target: -1 });
    this.lowerStatement(statement.consequent);
    if (!statement.alternate) {
      this.patch(jmpFalse, this.code.length);
      return;
    }
    const jmpEnd = this.emit({ op: Op.JUMP, target: -1 });
    this.patch(jmpFalse, this.code.length);
    this.lowerStatement(statement.alternate);
    this.patch(jmpEnd, this.code.length);
  }

  lowerWhile(statement) {
    const loopStart = this.code.length;
    const cond = this.lowerExpression(statement.test);
    const jmpExit = this.emit({ op: Op.JUMP_IF_FALSE, cond, target: -1 });
    this.lowerStatement(statement.body);
    this.emit({ op: Op.JUMP, target: loopStart });
    this.patch(jmpExit, this.code.length);
  }

  lowerExpression(expression) {
    switch (expression.type) {
      case "Literal":
        return this.emitLoadConst(expression.value);
      case "Identifier":
        return this.getLocal(expression.name);
      case "ThisExpression": {
        const dst = this.allocateRegister();
        this.emit({ op: Op.LOAD_THIS, dst });
        return dst;
      }
      case "BinaryExpression":
        return this.lowerBinary(expression);
      case "AssignmentExpression":
        return this.lowerAssignment(expression);
      case "MemberExpression":
        return this.lowerMemberLoad(expression);
      case "CallExpression":
        return this.lowerCall(expression);
      case "NewExpression":
        return this.lowerNew(expression);
      case "ObjectExpression":
        return this.lowerObjectLiteral(expression);
      default:
        throw new Error(`Unsupported expression in lowering: ${expression.type}`);
    }
  }

  lowerBinary(expression) {
    const left = this.lowerExpression(expression.left);
    const right = this.lowerExpression(expression.right);
    const dst = this.allocateRegister();
    if (expression.operator === "+") {
      this.emit({ op: Op.ADD, dst, left, right });
      return dst;
    }
    if (expression.operator === "<") {
      this.emit({ op: Op.LESS_THAN, dst, left, right });
      return dst;
    }
    throw new Error(`Unsupported binary operator '${expression.operator}'`);
  }

  lowerAssignment(expression) {
    const valueReg = this.lowerExpression(expression.right);
    if (expression.left.type === "Identifier") {
      this.emit({ op: Op.STORE_LOCAL, dst: this.getLocal(expression.left.name), src: valueReg });
      return valueReg;
    }
    if (expression.left.type === "MemberExpression") {
      const obj = this.lowerExpression(expression.left.object);
      this.emit({ op: Op.STORE_PROP, obj, name: expression.left.property.name, src: valueReg });
      return valueReg;
    }
    throw new Error(`Unsupported assignment target '${expression.left.type}'`);
  }

  lowerMemberLoad(expression) {
    const obj = this.lowerExpression(expression.object);
    const dst = this.allocateRegister();
    this.emit({ op: Op.LOAD_PROP, dst, obj, name: expression.property.name });
    return dst;
  }

  lowerCall(expression) {
    if (expression.callee.type === "MemberExpression") {
      const obj = this.lowerExpression(expression.callee.object);
      const args = expression.arguments.map((arg) => this.lowerExpression(arg));
      const dst = this.allocateRegister();
      this.emit({
        op: Op.CALL_METHOD,
        dst,
        obj,
        name: expression.callee.property.name,
        args
      });
      return dst;
    }
    const callee = this.lowerExpression(expression.callee);
    const args = expression.arguments.map((arg) => this.lowerExpression(arg));
    const dst = this.allocateRegister();
    this.emit({ op: Op.CALL, dst, callee, args });
    return dst;
  }

  lowerNew(expression) {
    const callee = this.lowerExpression(expression.callee);
    const args = expression.arguments.map((arg) => this.lowerExpression(arg));
    const dst = this.allocateRegister();
    this.emit({ op: Op.NEW, dst, callee, args });
    return dst;
  }

  lowerObjectLiteral(expression) {
    const obj = this.allocateRegister();
    this.emit({ op: Op.CREATE_OBJECT, dst: obj });
    for (const prop of expression.properties) {
      const value = this.lowerExpression(prop.value);
      this.emit({
        op: Op.DEFINE_DATA_PROP,
        obj,
        name: prop.key.name,
        src: value,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
    return obj;
  }

  allocateRegister() {
    return this.nextRegister++;
  }

  getLocal(name) {
    if (!this.localByName.has(name)) {
      throw new Error(`Unknown local '${name}' in '${this.info.name}'`);
    }
    return this.localByName.get(name);
  }

  emitLoadConst(value) {
    const index = this.getConstIndex(value);
    const dst = this.allocateRegister();
    this.emit({ op: Op.LOAD_CONST, dst, index });
    return dst;
  }

  getConstIndex(value) {
    const key = typeof value === "string" ? `str:${value}` : `prim:${String(value)}`;
    if (!this.constantIndex.has(key)) {
      this.constantIndex.set(key, this.constants.length);
      this.constants.push(value);
    }
    return this.constantIndex.get(key);
  }

  emit(instruction) {
    const index = this.code.length;
    this.code.push(instruction);
    return index;
  }

  patch(index, target) {
    this.code[index].target = target;
  }
}

export function lowerToBytecode(scopes) {
  const output = [];
  const visited = new Set();

  const emitFunction = (info) => {
    if (visited.has(info)) {
      return;
    }
    for (const nestedNode of info.nestedNodes) {
      emitFunction(scopes.byNode.get(nestedNode));
    }
    const lowerer = new FunctionLowerer(info, scopes);
    output.push(lowerer.lower());
    visited.add(info);
  };

  emitFunction(scopes.root);
  return output;
}
