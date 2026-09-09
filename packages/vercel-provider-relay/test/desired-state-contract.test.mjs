import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/desired-state-worker.ts", import.meta.url), "utf8");
const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const desired = JSON.parse(readFileSync(new URL("../../../config/vercel-provider-desired-state-v1.json", import.meta.url), "utf8"));

test("cloud provider uses the desired-state wrapper and a bounded five-minute cron", () => {
  assert.match(config, /"main":\s*"src\/desired-state-worker\.ts"/);
  assert.match(config, /"crons":\s*\["\*\/5 \* \* \* \*"\]/);
  assert.match(source, /async scheduled\(/);
  assert.match(source, /ctx\.waitUntil\(reconcile\(env\)/);
});

test("desired state is read from one fixed private EVAVO repository path", () => {
  assert.match(source, /const DESIRED_REPOSITORY = "EVAVO-STUDIO\/evavo-agent-infrastructure"/);
  assert.match(source, /const DESIRED_PATH = "config\/vercel-provider-desired-state-v1\.json"/);
  assert.match(source, /method:\s*"GET"/);
  assert.doesNotMatch(source, /githubGet\(env,.*(?:POST|PATCH|PUT|DELETE)/);
  assert.match(source, /githubMutationPerformed:\s*false/);
});

test("cloud desired-state reconciler has no destructive Vercel operation", () => {
  assert.doesNotMatch(source, /method:\s*"DELETE"/);
  assert.doesNotMatch(source, /domain\.remove/);
  assert.match(source, /destructiveProviderOperationPerformed:\s*false/);
});

test("Naomi canonical Vercel desired state is Git-backed and domain-complete", () => {
  assert.equal(desired.schemaVersion, 1);
  assert.equal(desired.kind, "evavo-vercel-provider-desired-state-v1");
  assert.equal(desired.enabled, true);
  assert.equal(desired.projects.length, 1);
  const project = desired.projects[0];
  assert.equal(project.name, "naomis30th");
  assert.equal(project.repository, "EVAVO-STUDIO/naomi-30-queen-of-hearts");
  assert.equal(project.rootDirectory, "deployment/vercel-guest-r15");
  assert.equal(project.productionBranch, "main");
  assert.equal(project.deployIfMissing, true);
  assert.deepEqual(project.domains, [
    { name: "naomis30th.com" },
    { name: "www.naomis30th.com", redirect: "naomis30th.com", redirectStatusCode: 308 },
  ]);
});

test("reconciliation is idempotent desired-state convergence", () => {
  assert.match(source, /vercelOptionalGet/);
  assert.match(source, /ensureProject/);
  assert.match(source, /ensureDeployment/);
  assert.match(source, /ensureDomain/);
  assert.match(source, /project-git-link-mismatch/);
  assert.match(source, /project-git-readback-mismatch/);
  assert.match(source, /project-root-readback-mismatch/);
  assert.match(source, /domain-readback-mismatch/);
  assert.match(source, /workstationRequired:\s*false/);
  assert.match(source, /credentialValuesReturned:\s*false/);
});
