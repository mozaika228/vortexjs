import { runTest262Profile, writeReport } from "./test262-lib.js";

function readArg(name, fallback) {
  const pref = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(pref)) {
      return arg.slice(pref.length);
    }
  }
  return fallback;
}

function main() {
  const profile = readArg("profile", "smoke-parse");
  const stats = runTest262Profile(profile);
  const reportPath = writeReport(profile, stats);

  const summary = {
    profile: stats.profile,
    mode: stats.mode,
    passRate: stats.passRate,
    considered: stats.considered,
    passed: stats.passed,
    failed: stats.failed,
    skipped: stats.skipped,
    reportPath
  };
  console.log(JSON.stringify(summary, null, 2));

  if (stats.failed > 0) {
    process.exitCode = 1;
  }
}

main();
