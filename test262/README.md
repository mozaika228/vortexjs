# test262 in VortexJS

This folder contains compatibility profiles and generated reports for running the official TC39 `test262` suite against VortexJS.

## Commands

```bash
# Clone test262 under third_party/test262
powershell -ExecutionPolicy Bypass -File scripts/test262-sync.ps1

# Parse-only compatibility smoke profile
npm run test262:smoke

# Execute subset profile (compile + execute)
npm run test262:exec
```

## Profiles

- `profiles/smoke-parse.json`: parser/lowering baseline over a filtered subset.
- `profiles/subset-exec.json`: runtime execution baseline over a filtered subset.

Both profiles apply:

- path filters (`includePathContains`, `excludePathContains`)
- metadata filters (`skipFlags`, `skipFeatures`)
- bounded sample size (`limit`)

This makes compatibility measurable from day one while the engine surface is still incomplete.

## Output

Each run writes `reports/<profile>.json` with:

- considered / passed / failed / skipped
- pass rate
- failed file list with error messages
