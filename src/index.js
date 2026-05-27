import { executeModuleGraph, executeSource } from "./engine.js";

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
      let c = new Counter(40);
      return c.inc(2);
    }

    return main();
  `;
  return executeSource(source);
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
const moduleRun = runModuleDemo();

console.log(
  JSON.stringify(
    {
      classResult: classRun.result,
      moduleRun: moduleRun.exports.get("run") ? "exported" : "missing",
      report: classRun.vmReport
    },
    null,
    2
  )
);
