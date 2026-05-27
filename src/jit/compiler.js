import { buildSSAIR, optimizeSSAIR } from "./ssa-ir.js";

export class DeoptError extends Error {
  constructor(pc, message) {
    super(message);
    this.pc = pc;
    this.name = "DeoptError";
  }
}

export class OptimizingJIT {
  constructor({ hotThreshold = 8 } = {}) {
    this.hotThreshold = hotThreshold;
    this.logs = [];
  }

  maybeCompile(fn, feedbackVector, runtime) {
    if (fn.optimized || fn.hotness < this.hotThreshold) {
      return;
    }
    const ssa = buildSSAIR(fn);
    const optimized = optimizeSSAIR(ssa, fn);
    fn.optimizationReport = optimized.stats;
    fn.ssaIR = optimized.ir;
    this.logs.push(`jit compile ${fn.name}`);
    this.logs.push(
      `opt passes ${fn.name}: ` +
        `CF=${optimized.stats.constantFolding},` +
        `DCE=${optimized.stats.dce},` +
        `GVN=${optimized.stats.gvn},` +
        `LICM=${optimized.stats.licm},` +
        `Inline=${optimized.stats.inlining}`
    );
    fn.optimized = this.compile(fn, feedbackVector, runtime);
  }

  compile(fn, feedbackVector, runtime) {
    const guards = new Map();
    for (const [pc, slot] of feedbackVector.slots.entries()) {
      const hottestMap = [...slot.maps.entries()].sort((a, b) => b[1] - a[1])[0];
      if (hottestMap) {
        guards.set(pc, hottestMap[0]);
      }
    }
    return {
      execute: (vm, closure, args, thisValue, isConstruct) => {
        const guardFn = (pc, receiver) => {
          const expectedMap = guards.get(pc);
          if (expectedMap && receiver?.map?.id !== expectedMap) {
            throw new DeoptError(pc, `map guard failed at pc ${pc}`);
          }
        };
        return runtime.interpret(closure, args, { guardFn, tier: "opt", thisValue, isConstruct });
      }
    };
  }
}
