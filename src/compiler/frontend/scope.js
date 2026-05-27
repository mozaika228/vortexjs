function collectLocals(body, localSet) {
  for (const statement of body) {
    if (statement.type === "ImportDeclaration") {
      for (const spec of statement.specifiers) {
        localSet.add(spec.local.name);
      }
    } else if (statement.type === "VariableDeclaration") {
      for (const decl of statement.declarations) {
        localSet.add(decl.id.name);
      }
    } else if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
      localSet.add(statement.id.name);
    } else if (statement.type === "ExportNamedDeclaration" && statement.declaration?.id?.name) {
      localSet.add(statement.declaration.id.name);
    }
  }
}

function lookupInAncestors(name, info) {
  let cursor = info;
  while (cursor) {
    if (cursor.locals.has(name) || cursor.params.has(name) || cursor.captures.has(name)) {
      return cursor;
    }
    cursor = cursor.parent;
  }
  return null;
}

function markCaptureChain(name, fromInfo, ownerInfo) {
  let cursor = fromInfo;
  while (cursor && cursor !== ownerInfo) {
    cursor.captures.add(name);
    cursor = cursor.parent;
  }
}

function resolveIdentifier(name, info) {
  if (info.locals.has(name) || info.params.has(name)) {
    return;
  }
  const owner = lookupInAncestors(name, info.parent);
  if (!owner) {
    throw new Error(`Unresolved identifier '${name}' in function '${info.name}'`);
  }
  info.captures.add(name);
  markCaptureChain(name, info.parent, owner);
}

function walkStatement(statement, info) {
  switch (statement.type) {
    case "ImportDeclaration":
      return;
    case "ExportNamedDeclaration":
      walkStatement(statement.declaration, info);
      return;
    case "ClassDeclaration":
      return;
    case "FunctionDeclaration":
      return;
    case "VariableDeclaration":
      for (const decl of statement.declarations) {
        if (decl.init) {
          walkExpression(decl.init, info);
        }
      }
      return;
    case "ReturnStatement":
      if (statement.argument) {
        walkExpression(statement.argument, info);
      }
      return;
    case "ExpressionStatement":
      walkExpression(statement.expression, info);
      return;
    case "IfStatement":
      walkExpression(statement.test, info);
      walkStatement(statement.consequent, info);
      if (statement.alternate) {
        walkStatement(statement.alternate, info);
      }
      return;
    case "WhileStatement":
      walkExpression(statement.test, info);
      walkStatement(statement.body, info);
      return;
    case "BlockStatement":
      for (const nested of statement.body) {
        walkStatement(nested, info);
      }
      return;
    default:
      throw new Error(`Unsupported statement in scope resolver: ${statement.type}`);
  }
}

function walkExpression(expression, info) {
  switch (expression.type) {
    case "Literal":
    case "ThisExpression":
      return;
    case "Identifier":
      resolveIdentifier(expression.name, info);
      return;
    case "BinaryExpression":
      walkExpression(expression.left, info);
      walkExpression(expression.right, info);
      return;
    case "AssignmentExpression":
      walkAssignmentTarget(expression.left, info);
      walkExpression(expression.right, info);
      return;
    case "CallExpression":
    case "NewExpression":
      walkExpression(expression.callee, info);
      for (const arg of expression.arguments) {
        walkExpression(arg, info);
      }
      return;
    case "MemberExpression":
      walkExpression(expression.object, info);
      return;
    case "ObjectExpression":
      for (const prop of expression.properties) {
        walkExpression(prop.value, info);
      }
      return;
    default:
      throw new Error(`Unsupported expression in scope resolver: ${expression.type}`);
  }
}

function walkAssignmentTarget(target, info) {
  if (target.type === "Identifier") {
    resolveIdentifier(target.name, info);
  } else if (target.type === "MemberExpression") {
    walkExpression(target.object, info);
  } else {
    throw new Error(`Unsupported assignment target: ${target.type}`);
  }
}

function normalizeFunctionNode(node, fallbackName) {
  if (node.type === "FunctionDeclaration") {
    return node;
  }
  if (node.type === "FunctionExpression") {
    return {
      type: "FunctionDeclaration",
      id: node.id ?? { type: "Identifier", name: fallbackName },
      params: node.params,
      body: node.body
    };
  }
  throw new Error(`Expected function node, got ${node.type}`);
}

function analyzeFunction(functionNode, parentInfo, output) {
  const info = {
    node: functionNode,
    name: functionNode.id?.name ?? "<anon>",
    parent: parentInfo,
    params: new Set(functionNode.params.map((param) => param.name)),
    locals: new Set(),
    captures: new Set(),
    nestedNodes: []
  };
  output.push(info);

  const body = functionNode.body.body;
  collectLocals(body, info.locals);

  for (const statement of body) {
    if (statement.type === "FunctionDeclaration") {
      info.nestedNodes.push(statement);
      continue;
    }
    if (statement.type === "ClassDeclaration") {
      const hasCtor = statement.body.body.some((m) => m.kind === "constructor");
      if (!hasCtor) {
        info.nestedNodes.push({
          type: "FunctionDeclaration",
          id: { type: "Identifier", name: `${statement.id.name}::constructor_default` },
          params: [],
          body: { type: "BlockStatement", body: [] }
        });
      }
      for (const method of statement.body.body) {
        const fnNode = normalizeFunctionNode(
          method.value,
          `${statement.id.name}::${method.kind === "constructor" ? "constructor" : method.key.name}`
        );
        info.nestedNodes.push(fnNode);
      }
      continue;
    }
    if (statement.type === "ExportNamedDeclaration") {
      const decl = statement.declaration;
      if (decl.type === "FunctionDeclaration") {
        info.nestedNodes.push(decl);
        continue;
      }
      if (decl.type === "ClassDeclaration") {
        const hasCtor = decl.body.body.some((m) => m.kind === "constructor");
        if (!hasCtor) {
          info.nestedNodes.push({
            type: "FunctionDeclaration",
            id: { type: "Identifier", name: `${decl.id.name}::constructor_default` },
            params: [],
            body: { type: "BlockStatement", body: [] }
          });
        }
        for (const method of decl.body.body) {
          const fnNode = normalizeFunctionNode(
            method.value,
            `${decl.id.name}::${method.kind === "constructor" ? "constructor" : method.key.name}`
          );
          info.nestedNodes.push(fnNode);
        }
      }
    }
    walkStatement(statement, info);
  }

  for (const nested of info.nestedNodes) {
    analyzeFunction(nested, info, output);
  }
}

export function resolveScopes(program) {
  const rootFn = {
    type: "FunctionDeclaration",
    id: { type: "Identifier", name: "__module__" },
    params: [
      { type: "Identifier", name: "__vortex_import__" },
      { type: "Identifier", name: "__vortex_export__" }
    ],
    body: { type: "BlockStatement", body: program.body }
  };
  const functions = [];
  analyzeFunction(rootFn, null, functions);
  const byNode = new Map(functions.map((info) => [info.node, info]));
  return { root: functions[0], functions, byNode };
}
