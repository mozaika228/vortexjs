import { tokenize } from "./frontend/lexer.js";
import { Parser } from "./frontend/parser.js";
import { resolveScopes } from "./frontend/scope.js";
import { lowerToBytecode } from "./frontend/lowering.js";

export function compileSource(source) {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  const ast = parser.parseProgram();
  const scopes = resolveScopes(ast);
  const functions = lowerToBytecode(scopes);
  return { tokens, ast, scopes, functions };
}
