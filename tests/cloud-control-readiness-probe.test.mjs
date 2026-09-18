import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const probe = readFileSync(new URL("../scripts/Probe-EvavoCloudControlReadiness.mjs", import.meta.url), "utf8");
const endpoints = JSON.parse(readFileSync(new URL("../config/cloud-control-endpoints-v1.json", import.meta.url), "utf8"));
const vercelRoutes = JSON.parse(readFileSync(new URL("../config/agent-capability-routes-vercel-v2.json", import.meta.url), "utf8"));

test("cloud readiness probe is read-only and live-evidence based", () => {
  assert.match(probe, /lookup\(baseUrl\.hostname/);
  assert.match(probe, /method:\s*"GET"/);
  assert.match(probe, /AbortSignal\.timeout/);
  assert.match(probe, /configuredDoesNotMeanDeployed:\s*true/);
  assert.match(probe, /liveHealthRequiredForSelection:\s*true/);
  assert.match(probe, /mutationPerformed:\s*false/);
  assert.match(probe, /credentialValuesReturned:\s*false/);
  assert.doesNotMatch(probe, /authorization\s*:/i);
  assert.doesNotMatch(probe, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
});

test("canonical cloud endpoints require live health before route selection", () => {
  assert.equal(endpoints.configuredEndpointIsAvailabilityEvidence, false);
  assert.equal(endpoints.liveHealthRequiredForSelection, true);
  for (const endpoint of Object.values(endpoints.endpoints)) {
    assert.equal(endpoint.configuredDoesNotMeanDeployed, true);
    assert.equal(endpoint.liveHealthRequiredForSelection, true);
  }
});

test("Vercel V2 prefers cloud provider only after its health contract passes", () => {
  assert.equal(vercelRoutes.preferredProviderEndpoint, "vercel-provider-cloud-mcp");
  assert.equal(vercelRoutes.preferredRequiresLiveHealth, true);
  assert.equal(vercelRoutes.configuredEndpointIsAvailabilityEvidence, false);
  assert.equal(vercelRoutes.unresolvedPreferredEndpointDisposition, "evaluate-fallback");
  assert.deepEqual(vercelRoutes.providerHealthRequirements, [
    "dns-resolves",
    "health-http-200",
    "ok-true",
    "workstationRequired-false",
    "providerCredentialConfigured-true",
    "controlCredentialConfigured-true",
    "desiredStateReconcilerConfigured-true",
  ]);
});
