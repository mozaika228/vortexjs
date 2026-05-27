const KEYWORDS = new Set([
  "function",
  "return",
  "let",
  "const",
  "var",
  "if",
  "else",
  "while",
  "class",
  "new",
  "this",
  "import",
  "export",
  "from",
  "true",
  "false",
  "null"
]);

function isDigit(ch) {
  return ch >= "0" && ch <= "9";
}

function isIdentStart(ch) {
  return /[A-Za-z_$]/.test(ch);
}

function isIdentPart(ch) {
  return /[A-Za-z0-9_$]/.test(ch);
}

export function tokenize(source) {
  const tokens = [];
  let i = 0;

  const push = (type, value = null) => {
    tokens.push({ type, value, index: i });
  };

  while (i < source.length) {
    const ch = source[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") {
        i += 1;
      }
      continue;
    }

    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }

    if (isDigit(ch)) {
      const start = i;
      while (i < source.length && isDigit(source[i])) {
        i += 1;
      }
      if (source[i] === ".") {
        i += 1;
        while (i < source.length && isDigit(source[i])) {
          i += 1;
        }
      }
      push("number", Number(source.slice(start, i)));
      continue;
    }

    if (ch === `"` || ch === "'") {
      const quote = ch;
      i += 1;
      let value = "";
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          i += 1;
          value += source[i] ?? "";
          i += 1;
          continue;
        }
        value += source[i];
        i += 1;
      }
      if (source[i] !== quote) {
        throw new Error("Unterminated string literal");
      }
      i += 1;
      push("string", value);
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      i += 1;
      while (i < source.length && isIdentPart(source[i])) {
        i += 1;
      }
      const value = source.slice(start, i);
      if (KEYWORDS.has(value)) {
        push("keyword", value);
      } else {
        push("identifier", value);
      }
      continue;
    }

    const twoChar = source.slice(i, i + 2);
    if (twoChar === "==" || twoChar === "!=" || twoChar === "<=" || twoChar === ">=") {
      push("operator", twoChar);
      i += 2;
      continue;
    }

    if ("+-*/=<>{}()[],;.:".includes(ch)) {
      const type = "{}()[],;.:".includes(ch) ? "punct" : "operator";
      push(type, ch);
      i += 1;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at ${i}`);
  }

  tokens.push({ type: "eof", value: "eof", index: i });
  return tokens;
}
