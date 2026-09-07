import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");

test("remote relay admits Vercel only through the typed vercel.control action", () => {
  assert.match(source, /const VERCEL_ACTIONS = new Set\(\["vercel\.control"\]\)/);
  assert.match(source, /\.\.\.VERCEL_ACTIONS/);
  assert.match(source, /vercelTypedControlAvailableThroughAuthenticatedDispatch/);
  assert.doesNotMatch(source, /VERCEL_ACTIONS\s*=\s*new Set\([^)]*vercel\.api\.call/s);
  assert.doesNotMatch(source, /VERCEL_ACTIONS\s*=\s*new Set\([^)]*vercel\.deployment\.deploy/s);
});

test("remote Vercel arguments are operation-specific and raw API fields stay rejected", () => {
  assert.match(source, /const VERCEL_REMOTE_FIELDS/);
  for (const operation of [
    "project.list", "project.get", "project.update", "project.delete",
    "env.list", "env.set", "env.delete",
    "deployment.list", "deployment.get", "deployment.redeploy", "deployment.promote", "deployment.rollback",
    "domain.list", "domain.get", "domain.add", "domain.update", "domain.verify", "domain.remove", "domain.config", "domain.dns-plan",
    "dns.list", "dns.create", "dns.update", "dns.delete",
  ]) assert.match(source, new RegExp(`\\"${operation.replaceAll(".", "\\.")}\\"`));

  const validatorStart = source.indexOf("function validateVercelArguments");
  const validatorEnd = source.indexOf("function stub", validatorStart);
  assert.ok(validatorStart >= 0 && validatorEnd > validatorStart);
  const validator = source.slice(validatorStart, validatorEnd);
  assert.match(validator, /vercel-operation-not-admitted/);
  assert.match(validator, /vercel-argument-not-admitted/);
  assert.doesNotMatch(validator, /method|body|verify|cwd/);
});

test("remote Vercel writes require reasons and destructive writes require an explicit destructive grant", () => {
  assert.match(source, /const VERCEL_WRITE_OPERATIONS = new Set/);
  assert.match(source, /const VERCEL_DESTRUCTIVE_OPERATIONS = new Set/);
  assert.match(source, /vercel-mutation-reason-required/);
  assert.match(source, /vercel-allow-destructive-required/);
  for (const destructive of ["project.delete", "env.delete", "custom-environment.delete", "deployment.delete", "domain.remove", "dns.delete"]) {
    assert.match(source, new RegExp(destructive.replaceAll(".", "\\.")));
  }
});

test("environment values never cross the remote relay as literals", () => {
  assert.match(source, /operation === "env\.set"/);
  assert.match(source, /vercel-env-literal-value-forbidden/);
  assert.match(source, /valueFromEnv/);
  assert.match(source, /vercel-env-reference-invalid/);
});

test("all Vercel remote dispatch is treated as effectful for ambiguity and replay safety", () => {
  assert.match(source, /const EFFECTFUL_ACTIONS = new Set/);
  assert.match(source, /\.\.\.VERCEL_ACTIONS/);
  assert.match(source, /sideEffectMayHaveCommitted/);
  assert.match(source, /retrySafe/);
  assert.match(source, /automaticReplayAllowed:\s*false/);
});
