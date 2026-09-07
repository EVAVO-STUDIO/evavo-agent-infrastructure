import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("Vercel relay is one fixed typed action and is always effectful", () => {
  assert.match(source, /const VERCEL_ACTIONS = new Set\(\["vercel\.control"\]\)/);
  assert.match(source, /\.\.\.VERCEL_ACTIONS/);
  const effectfulStart = source.indexOf("const EFFECTFUL_ACTIONS");
  const actionStart = source.indexOf("const ACTIONS", effectfulStart);
  assert.ok(effectfulStart >= 0 && actionStart > effectfulStart);
  assert.match(source.slice(effectfulStart, actionStart), /\.\.\.VERCEL_ACTIONS/);
  assert.match(source, /automaticReplayOfUncertainEffect:\s*false/);
  assert.match(source, /automaticReplayAllowed:\s*false/);
});

test("Vercel cloud validator has a fixed operation and field allowlist", () => {
  assert.match(source, /const VERCEL_REMOTE_FIELDS/);
  for (const operation of [
    "project.get", "project.update", "env.list", "env.set", "domain.list", "domain.get", "domain.add",
    "domain.update", "domain.verify", "domain.remove", "domain.config", "domain.dns-plan",
    "dns.list", "dns.create", "dns.update", "dns.delete", "deployment.redeploy", "deployment.promote",
  ]) assert.match(source, new RegExp(operation.replaceAll(".", "\\.")));
  assert.doesNotMatch(source, /"api\.call": new Set/);
  assert.doesNotMatch(source, /"deployment\.deploy": new Set/);
  assert.match(source, /vercel-operation-not-admitted/);
  assert.match(source, /vercel-argument-not-admitted/);
});

test("Vercel secret input and destructive writes fail closed at Cloudflare", () => {
  assert.match(source, /VERCEL_WRITE_OPERATIONS/);
  assert.match(source, /VERCEL_DESTRUCTIVE_OPERATIONS/);
  assert.match(source, /vercel-mutation-reason-required/);
  assert.match(source, /vercel-allow-destructive-required/);
  assert.match(source, /vercel-env-literal-value-forbidden/);
  assert.match(source, /valueFromEnv/);
  assert.doesNotMatch(source, /VERCEL_TOKEN|VERCEL_API_TOKEN/);
});

test("Vercel dispatch is asynchronous by default and uses bounded long deadline", () => {
  assert.match(source, /const longRunning = STORAGE_ACTIONS\.has\(action\) \|\| VERCEL_ACTIONS\.has\(action\)/);
  assert.match(source, /MAX_DEADLINE_MS = 10 \* 60_000/);
  assert.match(source, /!\(STORAGE_ACTIONS\.has\(action\) \|\| VERCEL_ACTIONS\.has\(action\)\)/);
  assert.match(source, /vercelTypedControlAvailableThroughAuthenticatedDispatch/);
});

test("documentation keeps Vercel tokens machine-side and raw API unavailable", () => {
  assert.match(readme, /Vercel/i);
  assert.match(readme, /vercel\.control/);
  assert.match(readme, /VERCEL_(?:TOKEN|API_TOKEN)/);
  assert.match(readme, /never.*(?:relay|Cloudflare)|does not cross/i);
  assert.match(readme, /api\.call/);
});
