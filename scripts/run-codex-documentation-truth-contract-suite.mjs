#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const schemaPaths = [
  "schemas/codex-documentation-truth-fixture-scenario-v1.schema.json",
  "schemas/codex-documentation-truth-fixture-supervision-v1.schema.json",
  "schemas/codex-documentation-truth-physical-acceptance-v1.schema.json",
  "schemas/codex-documentation-truth-activation-readiness-v1.schema.json",
  "schemas/codex-documentation-truth-source-observation-v1.schema.json",
];
const javascriptPaths = [
  "scripts/compile-codex-documentation-truth-physical-acceptance.mjs",
  "scripts/compile-codex-documentation-truth-acceptance-readiness.mjs",
  "scripts/compile-codex-documentation-truth-source-observation.mjs",
  "scripts/test-codex-documentation-truth-physical-acceptance.mjs",
  "scripts/test-codex-documentation-truth-source-observation.mjs",
  "scripts/check-codex-documentation-truth-physical-acceptance-contract.mjs",
  "scripts/run-codex-documentation-truth-contract-suite.mjs",
];
const failures = [];

for (const schemaPath of schemaPaths) {
  try {
    const stat = fs.lstatSync(schemaPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("must be a regular non-symlink file");
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
      throw new Error("must use Draft 2020-12");
    }
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      throw new Error("must be a closed object schema");
    }
    if (typeof schema.title !== "string" || !schema.title.includes("Documentation Truth")) {
      throw new Error("must have a documentation-truth title");
    }
  } catch (error) {
    failures.push(`${schemaPath}: ${error?.message ?? error}`);
  }
}

for (const javascriptPath of javascriptPaths) {
  const syntax = spawnSync(process.execPath, ["--check", javascriptPath], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
  });
  if (syntax.status !== 0) {
    failures.push(`${javascriptPath}: ${String(syntax.stderr || syntax.stdout).trim()}`);
  }
}

for (const command of [
  "scripts/check-codex-documentation-truth-physical-acceptance-contract.mjs",
  "scripts/test-codex-documentation-truth-source-observation.mjs",
]) {
  if (failures.length > 0) break;
  const result = spawnSync(process.execPath, [command], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    failures.push(`${command}: ${String(result.stderr || result.stdout).trim()}`);
  }
}

if (failures.length > 0) {
  console.error("Documentation-truth contract suite failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Documentation-truth contract suite passed.");
console.log("- staged profile, policy, compilers and five closed schemas are coherent");
console.log("- four supervised fixture scenarios remain mandatory");
console.log("- clean main, exact origin, source revision and source-policy bytes are independently observable");
console.log("- physical evidence yields source review readiness, never automatic activation");
console.log("- lease, model, Git, publication, deployment, financial and paid-fallback authority remain disabled");
