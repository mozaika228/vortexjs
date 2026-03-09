import { VM, buildDemoProgram } from "./vm/interpreter.js";

function runDemo() {
  const vm = new VM();
  vm.registerFunctions(buildDemoProgram());
  const main = vm.createTopLevelClosure("main");
  const sumXY = vm.createTopLevelClosure("sumXY");

  let result;
  for (let i = 0; i < 8; i += 1) {
    result = vm.invoke(main, []);
  }

  const stableShape = vm.createObjectFromEntries([
    ["x", 10],
    ["y", 20]
  ]);
  const changedShape = vm.createObjectFromEntries([
    ["y", 1],
    ["x", 2]
  ]);

  let stableResult;
  for (let i = 0; i < 7; i += 1) {
    stableResult = vm.invoke(sumXY, [stableShape]);
  }
  const deoptResult = vm.invoke(sumXY, [changedShape]);

  const report = vm.report();
  console.log(JSON.stringify({ result, stableResult, deoptResult, report }, null, 2));
}

runDemo();
