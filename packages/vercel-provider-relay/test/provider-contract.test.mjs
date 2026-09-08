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

test("provider relay supports project-domain lifecycle and exact DNS planning", () => {
  for (const operation of ["domain.list", "domain.get", "domain.add", "domain.update", "domain.verify", "domain.remove", "domain.config", "domain.dns-plan"]) {
    assert.match(source, new RegExp(operation.replaceAll(".", "\\.")));
  }
  assert.match(source, /recommendedIPv4/);
  assert.match(source, /recommendedCNAME/);
  assert.match(source, /verification:\s*redact/);
});

test("writes require explicit execution and destructive domain removal is double-gated", () => {
  assert.match(source, /if \(write\) \{/);
  assert.match(source, /if \(!allowWrite\) return \{ ok: true, status: "planned", executed: false/);
  assert.match(source, /allow-destructive-required/);
});
