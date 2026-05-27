# vortexjs

`vortexjs` is a research JavaScript engine prototype implemented in plain Node.js. It is not a full V8 clone. The goal is to demonstrate the main subsystems behind a modern JS engine in a form that is small enough to inspect and evolve:

- Bytecode VM with register-based execution
- Source frontend: lexer, parser, AST, scope resolver, bytecode lowering
- Object model with prototype chain and data property descriptors
- `this` binding, `new` construction, and class declarations
- Basic ES module flow (`import { x } from "m"; export ...`) via module graph runtime
- Elements kinds arrays (`packed/holey`, `smi/double/object`) with index fast-paths
- Three execution tiers: interpreter -> baseline tier -> optimizing JIT
- Custom SSA IR in optimizing tier with CF, DCE, GVN, LICM, and inlining passes
- Hidden classes and map transitions
- Inline caches for property access sites
- Closure contexts and captured variables
- Type feedback collection
- Baseline tier (Sparkplug-style scaffold) and optimizing JIT with deoptimization
- Generational GC model with promotion and incremental marking events

## Scope

This repository currently implements a compact educational runtime with a full frontend pipeline for a focused JS subset. It still does **not** emit native machine code or manage raw memory directly. Those pieces remain represented as engine models inside Node.js so the architecture can be exercised locally.

## Run

```bash
npm start
```

The demo program:

1. Compiles JS source text through lexer/parser/scope/lowering.
2. Builds objects and triggers hidden-class transitions.
3. Reads properties through inline cache sites.
4. Creates closures with captured variables.
5. Warms functions enough to trigger optimized execution.
6. Emits a JSON report with frontend stats, feedback vectors, IC state, JIT activity, and GC activity.

Supported language subset right now:

- `function` declarations (including nested functions)
- `class` declarations with constructor and methods
- `let`/`const`/`var` declarations
- `return`, `if`/`else`, `while`, block statements
- Literals: number, string, boolean, null
- Object literals with static keys
- Array literals (including holey forms like `[1, , 3]`)
- Member access `obj.x`
- Computed index access `arr[i]` for load/store
- `this` and `new`
- module forms: `import {name} from "mod"` and `export` named declarations
- Calls `fn(a, b)`
- Assignment to identifiers and members
- Binary operators `+` and `<`

## Architecture

- [src/compiler/bytecode.js](./src/compiler/bytecode.js): bytecode function metadata and opcode set.
- [src/compiler/frontend/lexer.js](./src/compiler/frontend/lexer.js): tokenizer for the JS subset.
- [src/compiler/frontend/parser.js](./src/compiler/frontend/parser.js): recursive-descent parser into AST.
- [src/compiler/frontend/scope.js](./src/compiler/frontend/scope.js): lexical scope and capture analysis.
- [src/compiler/frontend/lowering.js](./src/compiler/frontend/lowering.js): AST + scope lowering into bytecode.
- [src/compiler/compile.js](./src/compiler/compile.js): end-to-end source compilation pipeline.
- [src/engine.js](./src/engine.js): compile + execute helper for script sources.
- [src/runtime/hidden-class.js](./src/runtime/hidden-class.js): hidden classes and transition trees.
- [src/runtime/object.js](./src/runtime/object.js): object storage backed by shape-derived slots.
- [src/runtime/context.js](./src/runtime/context.js): closure contexts and function values.
- [src/runtime/heap.js](./src/runtime/heap.js): young/old generations and incremental marking model.
- [src/vm/feedback.js](./src/vm/feedback.js): type and map feedback vectors.
- [src/vm/ic.js](./src/vm/ic.js): per-site inline caches.
- [src/jit/compiler.js](./src/jit/compiler.js): guarded optimizing tier with deoptimization.
- [src/jit/ssa-ir.js](./src/jit/ssa-ir.js): SSA IR builder and optimization passes.
- [src/vm/interpreter.js](./src/vm/interpreter.js): interpreter, call frames, and demo bytecode.

## test262 Compatibility

VortexJS now includes a test262 runner with compatibility profiles.

1. Clone test262:

```bash
powershell -ExecutionPolicy Bypass -File scripts/test262-sync.ps1
```

2. Run parser smoke profile:

```bash
npm run test262:smoke
```

3. Run execution subset profile:

```bash
npm run test262:exec
```

Reports are written to `test262/reports/*.json`.
The profiles are intentionally filtered to a currently supported subset of syntax and runtime semantics.

## Next steps

- Replace the JIT scaffold with a dedicated SSA/IR graph and lowering stages.
- Add write barriers and remembered sets to the GC model.
- Support arrays, prototypes, and more complete function semantics.
- Introduce on-stack replacement for hot loops.
