function createNode(type, fields) {
  return { type, ...fields };
}

export class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  parseProgram() {
    const body = [];
    while (!this.is("eof")) {
      body.push(this.parseStatement());
    }
    return createNode("Program", { body });
  }

  parseStatement() {
    if (this.matchKeyword("import")) {
      return this.parseImportDeclaration();
    }
    if (this.matchKeyword("export")) {
      return this.parseExportDeclaration();
    }
    if (this.matchKeyword("class")) {
      return this.parseClassDeclaration();
    }
    if (this.matchKeyword("function")) {
      return this.parseFunctionDeclaration();
    }
    if (this.matchKeyword("return")) {
      return this.parseReturnStatement();
    }
    if (this.matchKeyword("let") || this.matchKeyword("const") || this.matchKeyword("var")) {
      return this.parseVariableDeclaration();
    }
    if (this.matchKeyword("if")) {
      return this.parseIfStatement();
    }
    if (this.matchKeyword("while")) {
      return this.parseWhileStatement();
    }
    if (this.matchPunct("{")) {
      return this.parseBlockStatement();
    }
    return this.parseExpressionStatement();
  }

  parseImportDeclaration() {
    this.expectKeyword("import");
    this.expectPunct("{");
    const specifiers = [];
    if (!this.matchPunct("}")) {
      do {
        const imported = this.expect("identifier").value;
        specifiers.push(
          createNode("ImportSpecifier", {
            imported: createNode("Identifier", { name: imported }),
            local: createNode("Identifier", { name: imported })
          })
        );
      } while (this.consumePunct(","));
    }
    this.expectPunct("}");
    this.expectKeyword("from");
    const source = this.expect("string").value;
    this.consumePunct(";");
    return createNode("ImportDeclaration", { specifiers, source: createNode("Literal", { value: source }) });
  }

  parseExportDeclaration() {
    this.expectKeyword("export");
    if (this.matchKeyword("function")) {
      return createNode("ExportNamedDeclaration", { declaration: this.parseFunctionDeclaration() });
    }
    if (this.matchKeyword("class")) {
      return createNode("ExportNamedDeclaration", { declaration: this.parseClassDeclaration() });
    }
    if (this.matchKeyword("let") || this.matchKeyword("const") || this.matchKeyword("var")) {
      return createNode("ExportNamedDeclaration", { declaration: this.parseVariableDeclaration() });
    }
    throw this.error("Unsupported export declaration");
  }

  parseClassDeclaration() {
    this.expectKeyword("class");
    const id = createNode("Identifier", { name: this.expect("identifier").value });
    this.expectPunct("{");
    const body = [];
    while (!this.matchPunct("}")) {
      const key = createNode("Identifier", { name: this.expect("identifier").value });
      this.expectPunct("(");
      const params = [];
      if (!this.matchPunct(")")) {
        do {
          params.push(createNode("Identifier", { name: this.expect("identifier").value }));
        } while (this.consumePunct(","));
      }
      this.expectPunct(")");
      const methodBody = this.parseBlockStatement();
      body.push(
        createNode("MethodDefinition", {
          key,
          kind: key.name === "constructor" ? "constructor" : "method",
          value: createNode("FunctionExpression", { id: null, params, body: methodBody })
        })
      );
    }
    this.expectPunct("}");
    return createNode("ClassDeclaration", { id, body: createNode("ClassBody", { body }) });
  }

  parseFunctionDeclaration() {
    this.expectKeyword("function");
    const name = this.expect("identifier").value;
    this.expectPunct("(");
    const params = [];
    if (!this.matchPunct(")")) {
      do {
        params.push(createNode("Identifier", { name: this.expect("identifier").value }));
      } while (this.consumePunct(","));
    }
    this.expectPunct(")");
    const body = this.parseBlockStatement();
    return createNode("FunctionDeclaration", { id: createNode("Identifier", { name }), params, body });
  }

  parseReturnStatement() {
    this.expectKeyword("return");
    if (this.matchPunct(";")) {
      this.expectPunct(";");
      return createNode("ReturnStatement", { argument: null });
    }
    if (this.matchPunct("}")) {
      return createNode("ReturnStatement", { argument: null });
    }
    const argument = this.parseExpression();
    this.consumePunct(";");
    return createNode("ReturnStatement", { argument });
  }

  parseVariableDeclaration() {
    const kind = this.expect("keyword").value;
    const declarations = [];
    do {
      const id = createNode("Identifier", { name: this.expect("identifier").value });
      let init = null;
      if (this.consumeOperator("=")) {
        init = this.parseExpression();
      }
      declarations.push(createNode("VariableDeclarator", { id, init }));
    } while (this.consumePunct(","));
    this.consumePunct(";");
    return createNode("VariableDeclaration", { kind, declarations });
  }

  parseIfStatement() {
    this.expectKeyword("if");
    this.expectPunct("(");
    const test = this.parseExpression();
    this.expectPunct(")");
    const consequent = this.parseStatement();
    let alternate = null;
    if (this.consumeKeyword("else")) {
      alternate = this.parseStatement();
    }
    return createNode("IfStatement", { test, consequent, alternate });
  }

  parseWhileStatement() {
    this.expectKeyword("while");
    this.expectPunct("(");
    const test = this.parseExpression();
    this.expectPunct(")");
    const body = this.parseStatement();
    return createNode("WhileStatement", { test, body });
  }

  parseBlockStatement() {
    this.expectPunct("{");
    const body = [];
    while (!this.matchPunct("}")) {
      body.push(this.parseStatement());
    }
    this.expectPunct("}");
    return createNode("BlockStatement", { body });
  }

  parseExpressionStatement() {
    const expression = this.parseExpression();
    this.consumePunct(";");
    return createNode("ExpressionStatement", { expression });
  }

  parseExpression() {
    return this.parseAssignment();
  }

  parseAssignment() {
    const left = this.parseRelational();
    if (this.consumeOperator("=")) {
      const right = this.parseAssignment();
      return createNode("AssignmentExpression", { operator: "=", left, right });
    }
    return left;
  }

  parseRelational() {
    let expr = this.parseAdditive();
    while (this.matchOperator("<")) {
      this.expectOperator("<");
      expr = createNode("BinaryExpression", { operator: "<", left: expr, right: this.parseAdditive() });
    }
    return expr;
  }

  parseAdditive() {
    let expr = this.parseCallMember();
    while (this.matchOperator("+")) {
      this.expectOperator("+");
      expr = createNode("BinaryExpression", { operator: "+", left: expr, right: this.parseCallMember() });
    }
    return expr;
  }

  parseCallMember() {
    let expr = this.parseNewExpression();
    while (true) {
      if (this.consumePunct(".")) {
        expr = createNode("MemberExpression", {
          object: expr,
          property: createNode("Identifier", { name: this.expect("identifier").value }),
          computed: false
        });
        continue;
      }
      if (this.consumePunct("[")) {
        const property = this.parseExpression();
        this.expectPunct("]");
        expr = createNode("MemberExpression", { object: expr, property, computed: true });
        continue;
      }
      if (this.consumePunct("(")) {
        const args = [];
        if (!this.matchPunct(")")) {
          do {
            args.push(this.parseExpression());
          } while (this.consumePunct(","));
        }
        this.expectPunct(")");
        expr = createNode("CallExpression", { callee: expr, arguments: args });
        continue;
      }
      break;
    }
    return expr;
  }

  parseNewExpression() {
    if (!this.matchKeyword("new")) {
      return this.parsePrimary();
    }
    this.expectKeyword("new");
    let callee = this.parsePrimary();
    while (this.consumePunct(".")) {
      callee = createNode("MemberExpression", {
        object: callee,
        property: createNode("Identifier", { name: this.expect("identifier").value }),
        computed: false
      });
    }
    let args = [];
    if (this.consumePunct("(")) {
      args = [];
      if (!this.matchPunct(")")) {
        do {
          args.push(this.parseExpression());
        } while (this.consumePunct(","));
      }
      this.expectPunct(")");
    }
    return createNode("NewExpression", { callee, arguments: args });
  }

  parseObjectLiteral() {
    this.expectPunct("{");
    const properties = [];
    if (!this.matchPunct("}")) {
      do {
        const keyToken = this.consume("identifier") ?? this.consume("string") ?? this.consume("number");
        if (!keyToken) {
          throw this.error("Expected object property key");
        }
        const key = createNode("Identifier", { name: String(keyToken.value) });
        this.expectPunct(":");
        properties.push(createNode("Property", { key, value: this.parseExpression() }));
      } while (this.consumePunct(","));
    }
    this.expectPunct("}");
    return createNode("ObjectExpression", { properties });
  }

  parsePrimary() {
    if (this.match("number")) {
      return createNode("Literal", { value: this.expect("number").value });
    }
    if (this.match("string")) {
      return createNode("Literal", { value: this.expect("string").value });
    }
    if (this.matchKeyword("true")) {
      this.expectKeyword("true");
      return createNode("Literal", { value: true });
    }
    if (this.matchKeyword("false")) {
      this.expectKeyword("false");
      return createNode("Literal", { value: false });
    }
    if (this.matchKeyword("null")) {
      this.expectKeyword("null");
      return createNode("Literal", { value: null });
    }
    if (this.matchKeyword("this")) {
      this.expectKeyword("this");
      return createNode("ThisExpression", {});
    }
    if (this.match("identifier")) {
      return createNode("Identifier", { name: this.expect("identifier").value });
    }
    if (this.matchPunct("{")) {
      return this.parseObjectLiteral();
    }
    if (this.matchPunct("[")) {
      return this.parseArrayLiteral();
    }
    if (this.consumePunct("(")) {
      const expr = this.parseExpression();
      this.expectPunct(")");
      return expr;
    }
    throw this.error("Unexpected token in expression");
  }

  parseArrayLiteral() {
    this.expectPunct("[");
    const elements = [];
    while (!this.matchPunct("]")) {
      if (this.consumePunct(",")) {
        elements.push(null);
        continue;
      }
      elements.push(this.parseExpression());
      if (!this.consumePunct(",")) {
        break;
      }
    }
    this.expectPunct("]");
    return createNode("ArrayExpression", { elements });
  }

  consume(type) {
    if (this.match(type)) {
      const token = this.current();
      this.pos += 1;
      return token;
    }
    return null;
  }
  expect(type) {
    const token = this.consume(type);
    if (!token) {
      throw this.error(`Expected token type '${type}'`);
    }
    return token;
  }
  current() {
    return this.tokens[this.pos];
  }
  is(type, value) {
    const token = this.current();
    if (!token || token.type !== type) {
      return false;
    }
    return value === undefined || token.value === value;
  }
  match(type, value) {
    return this.is(type, value);
  }
  matchKeyword(value) {
    return this.is("keyword", value);
  }
  consumeKeyword(value) {
    if (!this.matchKeyword(value)) {
      return false;
    }
    this.pos += 1;
    return true;
  }
  expectKeyword(value) {
    if (!this.consumeKeyword(value)) {
      throw this.error(`Expected keyword '${value}'`);
    }
  }
  matchPunct(value) {
    return this.is("punct", value);
  }
  consumePunct(value) {
    if (!this.matchPunct(value)) {
      return false;
    }
    this.pos += 1;
    return true;
  }
  expectPunct(value) {
    if (!this.consumePunct(value)) {
      throw this.error(`Expected punctuation '${value}'`);
    }
  }
  matchOperator(value) {
    return this.is("operator", value);
  }
  consumeOperator(value) {
    if (!this.matchOperator(value)) {
      return false;
    }
    this.pos += 1;
    return true;
  }
  expectOperator(value) {
    if (!this.consumeOperator(value)) {
      throw this.error(`Expected operator '${value}'`);
    }
  }
  error(message) {
    const token = this.current();
    return new Error(`${message} at token '${token?.value ?? "eof"}' (index ${token?.index ?? -1})`);
  }
}
