import test from "node:test";
import assert from "node:assert/strict";

import {
  CLOUD_ROUTES,
  cloudFabricStatus,
  handleRequest,
  routeCloudProvider,
} from "../mcp-server/cloud-provider-routing-mcp.mjs";

test("cloud fabric exposes evidence-backed provider states", () => {
  const status = cloudFabricStatus();
  assert.equal(status.kind, "evavo-cloud-provider-routing-status-v1");
  assert.equal(status.routes.supabase.state, "connected-read-sql-and-diagnostic-proven");
  assert.equal(status.routes.firebase.state, "authenticated-project-inventory-and-cli-15.28.1-proven");
  assert.equal(status.routes.cloudinary.state, "connected-read-write-delete-lifecycle-proven");
  assert.match(status.routes.cloudflare.state, /auth-pending/);
  assert.match(status.routes.vercel.state, /auth-pending/);
  assert.match(status.routes.googleDrive.state, /personal-account-oauth-pending/);
  assert.match(status.routes.neonPostgres.state, /sql-wrapper-inconsistent/);
  assert.equal(status.policy.credentialValuesReturned, false);
  assert.equal(status.policy.destructiveRequiresSeparateEffectLease, true);
});

test("cloud routing resolves aliases without causing effects", () => {
  assert.equal(routeCloudProvider("drive").provider, "googleDrive");
  assert.equal(routeCloudProvider("r2").provider, "cloudflare");
  assert.equal(routeCloudProvider("firestore").provider, "firebase");
  assert.equal(routeCloudProvider("neon").provider, "neonPostgres");
  assert.throws(() => routeCloudProvider("unknown-provider"), /unsupported cloud provider/);
});

test("modern discovery and legacy initialize are both supported", () => {
  const modern = handleRequest({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} });
  assert.equal(modern.result.protocolVersion, "2026-07-28");
  assert.ok(modern.result.supportedVersions.includes("2024-11-05"));

  const legacy = handleRequest({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} });
  assert.equal(legacy.result.protocolVersion, "2024-11-05");
});

test("MCP tool surface is routing-only", () => {
  const listed = handleRequest({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
  const names = listed.result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ["evavo_cloud_fabric_status", "evavo_cloud_route"]);
  assert.equal(CLOUD_ROUTES.cloudflare.writeState, "disabled-until-cloudflare-account-identity-proven");
});
