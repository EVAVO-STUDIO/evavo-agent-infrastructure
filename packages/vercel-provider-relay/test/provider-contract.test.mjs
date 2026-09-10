import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");
const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

test("provider relay is explicitly independent of workstation liveness", () => {
  assert.match(source, /workstationRequired:\s*false/);
  assert.doesNotMatch(source, /WORKSTATION_RELAY|WORKSTATION_TOKEN|DurableObject/);
  assert.match(config, /evavo-vercel-provider-relay/);
});

test("provider relay keeps Vercel and control credentials in Worker secrets", () => {
  assert.match(source, /VERCEL_TOKEN:\s*string/);
  assert.match(source, /CONTROL_TOKEN:\s*string/);
  assert.match(source, /authorization:\s*`Bearer \$\{env\.VERCEL_TOKEN\}`/);
  assert.doesNotMatch(config, /VERCEL_TOKEN|CONTROL_TOKEN/);
  assert.match(source, /credentialValuesReturned:\s*false/);
});

test("provider relay supports Git-backed project and deployment creation", () => {
  assert.match(source, /"project\.create"/);
  assert.match(source, /\/v11\/projects/);
  assert.match(source, /gitRepository/);
  assert.match(source, /"deployment\.deploy"/);
  assert.match(source, /\/v13\/deployments/);
  assert.match(source, /gitSource:\s*\{\s*type:\s*"github",\s*org:\s*repo\.org,\s*repo:\s*repo\.repo,\s*ref\s*\}/);
  assert.match(source, /\^\(EVAVO-STUDIO\)/);
});

test("provider relay supports retry-safe desired-state project convergence", () => {
  assert.match(source, /"project\.ensure"/);
  assert.match(source, /providerOptionalGet/);
  assert.match(source, /projectGitMatches/);
  assert.match(source, /project-git-link-mismatch/);
  assert.match(source, /project-git-link-readback-mismatch/);
  assert.match(source, /project-settings-readback-mismatch/);
  assert.match(source, /state = "created"/);
  assert.match(source, /state = state === "created" \? "created-and-updated" : "updated"/);
});

test("project ensure converges and verifies the Git production branch", () => {
  assert.match(source, /function projectProductionBranchMatches\(/);
  assert.match(source, /request\.productionBranch === undefined \? undefined : branch\(request\.productionBranch\)/);
  assert.match(source, /\/v9\/projects\/\$\{encode\(providerProjectId\)\}\/branch/);
  assert.match(source, /\{ branch: desiredProductionBranch \}/);
  assert.match(source, /project-production-branch-readback-mismatch/);
  assert.match(source, /productionBranchReconciliation:\s*true/);
});

test("provider relay supports project-domain lifecycle and exact DNS planning", () => {
  for (const operation of ["domain.list", "domain.get", "domain.add", "domain.update", "domain.ensure", "domain.verify", "domain.remove", "domain.config", "domain.dns-plan"]) {
    assert.match(source, new RegExp(operation.replaceAll(".", "\\.")));
  }
  assert.match(source, /recommendedIPv4/);
  assert.match(source, /recommendedCNAME/);
  assert.match(source, /verification:\s*redact/);
});

test("domain ensure reads before writing and verifies desired state after mutation", () => {
  assert.match(source, /case "domain\.ensure"/);
  assert.match(source, /domainDelta/);
  assert.match(source, /assertDomainDesired/);
  assert.match(source, /domain-readback-mismatch/);
  assert.match(source, /\/v10\/projects\/\$\{encode\(projectId\)\}\/domains/);
});

test("writes require explicit execution and destructive domain removal is double-gated", () => {
  assert.match(source, /if \(write\) \{/);
  assert.match(source, /if \(!allowWrite\) return \{ ok: true, status: "planned", executed: false/);
  assert.match(source, /allow-destructive-required/);
});

test("health advertises desired-state and production-branch support without leaking credentials", () => {
  assert.match(source, /version:\s*"1\.2\.0"/);
  assert.match(source, /desiredStateOperations:\s*\["project\.ensure",\s*"domain\.ensure"\]/);
  assert.match(source, /productionBranchReconciliation:\s*true/);
  assert.match(source, /credentialValuesReturned:\s*false/);
});
