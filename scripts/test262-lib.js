import fs from "node:fs";
import path from "node:path";
import { compileSource } from "../src/compiler/compile.js";
import { executeSource } from "../src/engine.js";

const DEFAULT_TEST262_DIR = path.resolve(process.cwd(), "third_party", "test262", "test");

function walkFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!fs.existsSync(current)) {
      continue;
    }
    const stat = fs.statSync(current);
    if (stat.isFile()) {
      if (current.endsWith(".js")) {
        out.push(current);
      }
      continue;
    }
    const children = fs.readdirSync(current).map((name) => path.join(current, name));
    stack.push(...children);
  }
  return out.sort();
}

function parseFrontmatter(source) {
  const match = source.match(/\/\*---([\s\S]*?)---\*\//);
  if (!match) {
    return {};
  }
  const body = match[1];
  const metadata = {};

  const arrayField = (name) => {
    const m = body.match(new RegExp(`${name}:\\s*\\[([^\\]]*)\\]`));
    if (!m) {
      return [];
    }
    return m[1]
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  };

  metadata.flags = arrayField("flags");
  metadata.features = arrayField("features");
  metadata.includes = arrayField("includes");

  const phaseMatch = body.match(/negative:\s*[\r\n]+\s*phase:\s*([A-Za-z]+)/);
  const typeMatch = body.match(/negative:\s*[\s\S]*?type:\s*([A-Za-z0-9_]+)/);
  if (phaseMatch) {
    metadata.negative = {
      phase: phaseMatch[1],
      type: typeMatch ? typeMatch[1] : "Error"
    };
  }

  return metadata;
}

function matchAnySegment(value, rules) {
  if (!rules || rules.length === 0) {
    return false;
  }
  return rules.some((rule) => value.includes(rule));
}

function relativePosix(baseDir, filePath) {
  return path.relative(baseDir, filePath).split(path.sep).join("/");
}

function shouldSkipByMeta(meta, profile) {
  if (profile.skipFlags?.some((flag) => meta.flags?.includes(flag))) {
    return true;
  }
  if (profile.skipFeatures?.some((feature) => meta.features?.includes(feature))) {
    return true;
  }
  if (!profile.allowIncludesHarness && meta.includes?.length > 0) {
    return true;
  }
  return false;
}

function runOne({ filePath, source, mode }) {
  if (mode === "parse") {
    compileSource(source);
    return { ok: true };
  }
  if (mode === "execute") {
    executeSource(source);
    return { ok: true };
  }
  throw new Error(`Unknown test262 mode '${mode}'`);
}

export function loadProfile(profileName) {
  const profilePath = path.resolve(process.cwd(), "test262", "profiles", `${profileName}.json`);
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile not found: ${profilePath}`);
  }
  return JSON.parse(fs.readFileSync(profilePath, "utf-8"));
}

export function runTest262Profile(profileName) {
  const profile = loadProfile(profileName);
  const baseDir = path.resolve(process.cwd(), profile.test262Dir ?? DEFAULT_TEST262_DIR);
  if (!fs.existsSync(baseDir)) {
    throw new Error(
      `Test262 directory not found: ${baseDir}. Clone test262 under third_party/test262 or set test262Dir in profile.`
    );
  }

  const includeRoots = (profile.includeRoots ?? ["language"]).map((segment) => path.join(baseDir, segment));
  const files = includeRoots.flatMap((root) => walkFiles(root));
  const limit = Number.isInteger(profile.limit) ? profile.limit : files.length;

  const stats = {
    profile: profileName,
    mode: profile.mode ?? "parse",
    totalDiscovered: files.length,
    considered: 0,
    passed: 0,
    failed: 0,
    expectedNegative: 0,
    skipped: 0,
    skipReasons: {},
    failures: []
  };

  for (const filePath of files) {
    if (stats.considered >= limit) {
      break;
    }
    const rel = relativePosix(baseDir, filePath);

    if (matchAnySegment(rel, profile.excludePathContains)) {
      stats.skipped += 1;
      stats.skipReasons.excludePathContains = (stats.skipReasons.excludePathContains ?? 0) + 1;
      continue;
    }
    if (profile.includePathContains?.length > 0 && !matchAnySegment(rel, profile.includePathContains)) {
      stats.skipped += 1;
      stats.skipReasons.notInIncludePathContains = (stats.skipReasons.notInIncludePathContains ?? 0) + 1;
      continue;
    }

    const source = fs.readFileSync(filePath, "utf-8");
    const meta = parseFrontmatter(source);
    if (shouldSkipByMeta(meta, profile)) {
      stats.skipped += 1;
      stats.skipReasons.metadataFiltered = (stats.skipReasons.metadataFiltered ?? 0) + 1;
      continue;
    }

    stats.considered += 1;
    const expectParseError = meta.negative?.phase === "parse";
    if (expectParseError) {
      stats.expectedNegative += 1;
    }

    try {
      runOne({ filePath, source, mode: profile.mode ?? "parse" });
      if (expectParseError) {
        stats.failed += 1;
        stats.failures.push({
          file: rel,
          expected: "parse error",
          got: "success"
        });
      } else {
        stats.passed += 1;
      }
    } catch (error) {
      if (expectParseError) {
        stats.passed += 1;
      } else {
        stats.failed += 1;
        stats.failures.push({
          file: rel,
          error: String(error.message ?? error)
        });
      }
    }
  }

  stats.passRate = stats.considered === 0 ? 0 : Number(((stats.passed / stats.considered) * 100).toFixed(2));
  return stats;
}

export function writeReport(profileName, stats) {
  const outDir = path.resolve(process.cwd(), "test262", "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${profileName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(stats, null, 2));
  return outPath;
}
