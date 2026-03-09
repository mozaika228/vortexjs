# vortexjs

`vortexjs` is a research JavaScript engine prototype implemented in plain Node.js. It is not a full V8 clone. The goal is to demonstrate the main subsystems behind a modern JS engine in a form that is small enough to inspect and evolve:

- Bytecode VM with register-based execution
- Hidden classes and map transitions
- Inline caches for property access sites
- Closure contexts and captured variables
- Type feedback collection
- Optimizing JIT scaffold with guarded fast paths and deoptimization
- Generational GC model with promotion and incremental marking events

## Scope

This repository currently implements a compact educational runtime. It does **not** parse JavaScript source, emit machine code, or manage raw memory. Those pieces are represented as engine models inside Node.js so the runtime architecture can be exercised locally.

## Run

```bash
npm start
```

The demo program:

1. Builds an object and triggers hidden-class transitions.
2. Reads properties through inline cache sites.
3. Creates a closure with a captured variable.
4. Warms the function enough to trigger optimized execution.
5. Emits a JSON report with feedback vectors, IC state, JIT activity, and GC activity.

## Architecture

- [src/compiler/bytecode.js](./src/compiler/bytecode.js): bytecode function metadata and opcode set.
- [src/runtime/hidden-class.js](./src/runtime/hidden-class.js): hidden classes and transition trees.
- [src/runtime/object.js](./src/runtime/object.js): object storage backed by shape-derived slots.
- [src/runtime/context.js](./src/runtime/context.js): closure contexts and function values.
- [src/runtime/heap.js](./src/runtime/heap.js): young/old generations and incremental marking model.
- [src/vm/feedback.js](./src/vm/feedback.js): type and map feedback vectors.
- [src/vm/ic.js](./src/vm/ic.js): per-site inline caches.
- [src/jit/compiler.js](./src/jit/compiler.js): guarded optimizing tier with deoptimization.
- [src/vm/interpreter.js](./src/vm/interpreter.js): interpreter, call frames, and demo bytecode.

## Next steps

- Add a parser and lowering pipeline from a JS subset into bytecode.
- Replace the JIT scaffold with a dedicated SSA/IR graph and lowering stages.
- Add write barriers and remembered sets to the GC model.
- Support arrays, prototypes, and more complete function semantics.
- Introduce on-stack replacement for hot loops.
