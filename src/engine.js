import { compileSource } from "./compiler/compile.js";
import { VM } from "./vm/interpreter.js";

function createModuleRuntime(moduleExports) {
  const importHost = {
    __hostCall: (args) => {
      const [moduleName, exportName] = args;
      const exports = moduleExports.get(moduleName);
      if (!exports) {
        throw new Error(`Unknown module '${moduleName}'`);
      }
      if (!exports.has(exportName)) {
        throw new Error(`Module '${moduleName}' does not export '${exportName}'`);
      }
      return exports.get(exportName);
    }
  };
  const exportHost = {
    __hostCall: (args) => {
      const [moduleName, exportName, value] = args;
      if (!moduleExports.has(moduleName)) {
        moduleExports.set(moduleName, new Map());
      }
      moduleExports.get(moduleName).set(exportName, value);
      return value;
    }
  };
  return { importHost, exportHost };
}

function executeCompiledModule(vm, compilation, moduleName, moduleExports) {
  vm.registerFunctions(compilation.functions);
  const moduleClosure = vm.createTopLevelClosure("__module__");
  const { importHost, exportHost } = createModuleRuntime(moduleExports);
  moduleExports.set("__current__", moduleExports.get(moduleName) ?? new Map());
  const result = vm.invoke(moduleClosure, [importHost, exportHost]);
  if (!moduleExports.has(moduleName)) {
    moduleExports.set(moduleName, new Map());
  }
  const currentExports = moduleExports.get("__current__");
  moduleExports.set(moduleName, currentExports);
  return result;
}

export function executeSource(source) {
  const vm = new VM();
  const compilation = compileSource(source);
  const moduleExports = new Map();
  const result = executeCompiledModule(vm, compilation, "__main__", moduleExports);
  return { result, vmReport: vm.report(), compilation, moduleExports };
}

export function executeModuleGraph(modules, entryName = "main") {
  const vm = new VM();
  const moduleExports = new Map();
  const compiled = new Map();

  for (const [name, source] of Object.entries(modules)) {
    compiled.set(name, compileSource(source));
    moduleExports.set(name, new Map());
  }

  for (const [name, compilation] of compiled) {
    executeCompiledModule(vm, compilation, name, moduleExports);
  }

  const entryExports = moduleExports.get(entryName) ?? new Map();
  return { exports: entryExports, vmReport: vm.report(), moduleExports };
}
