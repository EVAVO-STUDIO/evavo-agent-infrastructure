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

test("remote Vercel arguments cover the governed lifecycle while raw API and caller paths stay rejected", () => {
  assert.match(source, /const VERCEL_REMOTE_FIELDS/);
  for (const operation of [
    "project.list", "project.get", "project.create", "project.update", "project.delete",
    "env.list", "env.set", "env.delete",
    "custom-environment.create", "custom-environment.delete",
    "deployment.list", "deployment.get", "deployment.deploy", "deployment.redeploy", "deployment.promote", "deployment.rollback", "deployment.cancel", "deployment.delete",
    "alias.assign",
    "domain.list", "domain.get", "domain.add", "domain.update", "domain.verify", "domain.remove", "domain.config", "domain.dns-plan",
    "dns.list", "dns.create", "dns.update", "dns.delete",
  ]) assert.match(source, new RegExp(`\\"${operation.replaceAll(".", "\\.")}\\"`));

  const fieldsStart = source.indexOf("const VERCEL_REMOTE_FIELDS");
  const fieldsEnd = source.indexOf("const VERCEL_WRITE_OPERATIONS", fieldsStart);
  assert.ok(fieldsStart >= 0 && fieldsEnd > fieldsStart);
  const fields = source.slice(fieldsStart, fieldsEnd);
  assert.doesNotMatch(fields, /"cwd"/);
  assert.doesNotMatch(fields, /"path"/);
  assert.doesNotMatch(fields, /"api\.call"/);

  const validatorStart = source.indexOf("function validateVercelArguments");
  const validatorEnd = source.indexOf("function stub", validatorStart);
  assert.ok(validatorStart >= 0 && validatorEnd > validatorStart);
  const validator = source.slice(validatorStart, validatorEnd);
  assert.match(validator, /vercel-operation-not-admitted/);
  assert.match(validator, /vercel-argument-not-admitted/);
  assert.doesNotMatch(validator, /\bcwd\b|\bmethod\b|\bverify\b/);
});

test("remote project creation and first deployment stay constrained to EVAVO repositories", () => {
  assert.match(source, /operation === "project\.create"/);
  assert.match(source, /vercel-git-repository-invalid/);
  assert.match(source, /vercel-git-provider-not-admitted/);
  assert.match(source, /vercel-git-repository-not-evavo/);
  assert.match(source, /operation === "deployment\.deploy"/);
  assert.match(source, /vercel-deployment-repository-not-evavo/);
  assert.match(source, /\^EVAVO-STUDIO\\\//);
  assert.match(source, /allowUnregisteredProject/);
  assert.match(source, /vercel-allow-unregistered-project-invalid/);
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
  assert.doesNotMatch(source, /VERCEL_TOKEN|VERCEL_API_TOKEN/);
});

test("all Vercel remote dispatch is treated as effectful for ambiguity and replay safety", () => {
  assert.match(source, /const EFFECTFUL_ACTIONS = new Set/);
  assert.match(source, /\.\.\.VERCEL_ACTIONS/);
  assert.match(source, /sideEffectMayHaveCommitted/);
  assert.match(source, /retrySafe/);
  assert.match(source, /automaticReplayAllowed:\s*false/);
});
