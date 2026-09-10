import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const endpoints = JSON.parse(
  readFileSync(new URL("../../../config/cloud-control-endpoints-v1.json", import.meta.url), "utf8"),
);
const routes = JSON.parse(
  readFileSync(new URL("../../../config/agent-capability-routes-vercel-v2.json", import.meta.url), "utf8"),
);
const desired = JSON.parse(
  readFileSync(new URL("../../../config/vercel-provider-desired-state-v1.json", import.meta.url), "utf8"),
);
const providerWrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const workstationWrangler = readFileSync(
  new URL("../../remote-mcp-relay/wrangler.jsonc", import.meta.url),
  "utf8",
);

test("cloud control endpoints are deterministic and contain no credentials", () => {
  assert.equal(endpoints.schemaVersion, 1);
  assert.equal(endpoints.kind, "evavo-cloud-control-endpoints-v1");
  assert.equal(endpoints.status, "canonical");
  assert.equal(endpoints.accountWorkersSubdomain, "evavo.workers.dev");
  assert.equal(endpoints.credentialValuesIncluded, false);

  const provider = endpoints.endpoints["vercel-provider-cloud-mcp"];
  assert.equal(provider.workerName, "evavo-vercel-provider-relay");
  assert.equal(provider.baseUrl, "https://evavo-vercel-provider-relay.evavo.workers.dev");
  assert.equal(provider.healthPath, "/health");
  assert.equal(provider.mcpPath, "/mcp");
  assert.equal(provider.controlPath, "/api/control");
  assert.equal(provider.reconcilePath, "/api/reconcile");
  assert.equal(provider.workstationRequired, false);
  assert.equal(provider.credentialsEmbedded, false);

  const workstation = endpoints.endpoints["workstation-typed-relay"];
  assert.equal(workstation.workerName, "evavo-workstation-mcp-relay");
  assert.equal(workstation.baseUrl, "https://evavo-workstation-mcp-relay.evavo.workers.dev");
  assert.equal(workstation.healthPath, "/health");
  assert.equal(workstation.mcpPath, "/mcp");
  assert.equal(workstation.websocketPath, "/ws");
  assert.equal(workstation.dispatchPath, "/api/dispatch");
  assert.equal(workstation.requestStatusPath, "/api/request");
  assert.equal(workstation.workstationRequired, true);
  assert.equal(workstation.credentialsEmbedded, false);
});

test("Vercel routes resolve through the endpoint registry and stay workstation independent", () => {
  assert.equal(routes.endpointRegistry, "config/cloud-control-endpoints-v1.json");
  assert.equal(routes.preferredProviderEndpoint, "vercel-provider-cloud-mcp");
  assert.equal(routes.providerControlMustSurviveWorkstationOutage, true);

  const providerCapabilities = new Set([
    "vercel.inspect",
    "vercel.configure",
    "vercel.deploy",
    "vercel.domain-dns",
  ]);
  const providerRoutes = routes.routes.filter((route) => providerCapabilities.has(route.capability));
  assert.equal(providerRoutes.length, providerCapabilities.size);
  for (const route of providerRoutes) {
    assert.equal(route.preferred, "vercel-provider-cloud-mcp");
    assert.equal(route.workstationRequired, false);
  }
});

test("both Cloudflare control relays explicitly retain workers.dev ingress", () => {
  assert.match(providerWrangler, /"name":\s*"evavo-vercel-provider-relay"/);
  assert.match(providerWrangler, /"workers_dev":\s*true/);
  assert.match(workstationWrangler, /"name":\s*"evavo-workstation-mcp-relay"/);
  assert.match(workstationWrangler, /"workers_dev":\s*true/);
});

test("Naomi desired state remains bound to the cloud Git-backed Vercel route", () => {
  assert.equal(desired.enabled, true);
  const project = desired.projects.find((candidate) => candidate.name === "naomis30th");
  assert.ok(project);
  assert.equal(project.repository, "EVAVO-STUDIO/naomi-30-queen-of-hearts");
  assert.equal(project.rootDirectory, "deployment/vercel-guest-r15");
  assert.equal(project.productionBranch, "main");
  assert.equal(project.deployIfMissing, true);
  assert.deepEqual(project.domains, [
    { name: "naomis30th.com" },
    { name: "www.naomis30th.com", redirect: "naomis30th.com", redirectStatusCode: 308 },
  ]);
});
