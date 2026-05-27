export class BaselineCompiler {
  constructor({ hotThreshold = 3 } = {}) {
    this.hotThreshold = hotThreshold;
    this.logs = [];
  }

  maybeCompile(fn, runtime) {
    if (fn.baseline || fn.hotness < this.hotThreshold) {
      return;
    }
    this.logs.push(`baseline compile ${fn.name}`);
    fn.baseline = this.compile(fn, runtime);
  }

  compile(fn, runtime) {
    return {
      execute: (closure, args, thisValue, isConstruct) =>
        runtime.interpret(closure, args, {
          tier: "baseline",
          thisValue,
          isConstruct
        })
    };
  }
}
