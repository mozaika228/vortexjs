import { executeModuleGraph, executeSource } from "./engine.js";
import { compileSource } from "./compiler/compile.js";
import { VM } from "./vm/interpreter.js";

function runClassDemo() {
  const source = `
    class Counter {
      constructor(start) {
        this.value = start;
      }
      inc(step) {
        this.value = this.value + step;
        return this.value;
      }
    }

    function main() {
      function hotLoop(limit) {
        let i = 0;
        let s = 0;
        while (i < limit) {
          s = s + 1;
          i = i + 1;
        }
        return s;
      }

      let c = new Counter(40);
      let i = 0;
      while (i < 10) {
        c.inc(1);
        i = i + 1;
      }
      let warm = hotLoop(20);
      c.other = 1;
      return c.inc(2) + warm;
    }

    return main();
  `;
  return executeSource(source);
}

function runArrayKindsDemo() {
  const source = `
    function main() {
      let packed = [1, 2, 3];
      packed[1] = 2.5;
      packed[2] = { v: 7 };

      let holey = [1, , 3];
      holey[5] = 10;

      return packed[0] + holey[5];
    }
    return main();
  `;
  const compilation = compileSource(source);
  const vm = new VM();
  vm.registerFunctions(compilation.functions);
  const main = vm.createTopLevelClosure("main");
  let result;
  for (let i = 0; i < 10; i += 1) {
    result = vm.invoke(main, []);
  }
  return { result, vmReport: vm.report() };
}

function runModuleDemo() {
  const modules = {
    math: `
      export function plus(a, b) {
        return a + b;
      }
    `,
    main: `
      import { plus } from "math";
      export function run() {
        return plus(20, 22);
      }
    `
  };
  return executeModuleGraph(modules, "main");
}

const classRun = runClassDemo();
const arrayRun = runArrayKindsDemo();
const moduleRun = runModuleDemo();
const hotFns = (report) =>
  report.functions
    .filter((f) => f.optimized && f.x64Code)
    .map((f) => ({
      name: f.name,
      codeSize: f.x64Code.size,
      regs: f.registerAllocation?.registersUsed ?? [],
      spills: f.registerAllocation?.spillCount ?? 0
    }));

console.log(
  JSON.stringify(
    {
      classResult: classRun.result,
      arrayResult: arrayRun.result,
      moduleRun: moduleRun.exports.get("run") ? "exported" : "missing",
      arrayKindsSeen: arrayRun.vmReport.functions.flatMap((fn) =>
        fn.feedback.flatMap((slot) => slot.types.map((entry) => entry[0]))
      ),
      x64Compiled: {
        class: hotFns(classRun.vmReport),
        array: hotFns(arrayRun.vmReport)
      },
      report: {
        class: classRun.vmReport,
        array: arrayRun.vmReport
      }
    },
    null,
    2
  )
);
