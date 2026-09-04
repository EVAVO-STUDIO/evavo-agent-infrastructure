#!/usr/bin/env node

import { createInterface } from "node:readline";

export const CLOUD_ROUTES = Object.freeze({
  supabase: Object.freeze({ authority: "provider-native:Supabase", state: "connected-read-sql-and-diagnostic-proven", writeState: "effect-policy-gated" }),
  firebase: Object.freeze({ authority: "EVAVO-STUDIO/evavo-local-compute:firebase-admin-cli", state: "authenticated-project-inventory-and-cli-15.28.1-proven", writeState: "project-scoped-postcondition-required" }),
  cloudinary: Object.freeze({ authority: "provider-native:Cloudinary", state: "connected-read-write-delete-lifecycle-proven", writeState: "exact-asset-or-folder-identity-required" }),
  cloudflare: Object.freeze({ authority: "EVAVO-STUDIO/evavo-development-studio:provider-transport", fallback: "EVAVO-STUDIO/evavo-local-compute:wrangler-4.127.1", state: "read-transport-available-wrangler-installed-auth-pending", writeState: "disabled-until-cloudflare-account-identity-proven" }),
  vercel: Object.freeze({ authority: "provider-native:Vercel", fallback: "EVAVO-STUDIO/evavo-local-compute:vercel-cli", state: "connected-diagnostics-proven-local-cli-installed-auth-pending", writeState: "local-mutations-disabled-until-cli-or-rest-identity-proven" }),
  googleDrive: Object.freeze({ authority: "provider-native:Google_Drive", state: "evavo-account-lifecycle-proven-personal-account-oauth-pending", writeState: "account-identity-required" }),
  evavoStorage: Object.freeze({ authority: "EVAVO-STUDIO/evavo-storage", state: "immutable-storage-authority-mcp-v2-migration-pending", writeState: "write-mode-and-exact-vault-identity-required" }),
  neonPostgres: Object.freeze({ authority: "provider-native:Neon_Postgres", state: "admin-visibility-proven-sql-wrapper-inconsistent", writeState: "blocked-until-connector-sql-contract-is-healthy" }),
});

export const CLOUD_ALIASES = Object.freeze({
  drive: "googleDrive",
  google: "googleDrive",
  gdrive: "googleDrive",
  r2: "cloudflare",
  workers: "cloudflare",
  pages: "cloudflare",
  firestore: "firebase",
  firebaseAuth: "firebase",
  postgres: "supabase",
  storage: "evavoStorage",
  immutableStorage: "evavoStorage",
  neon: "neonPostgres",
});

function normalizeProvider(provider) {
  if (typeof provider !== "string" || !provider.trim()) throw new Error("provider is required");
  const raw = provider.trim();
  if (CLOUD_ROUTES[raw]) return raw;
  const folded = raw.toLowerCase();
  const direct = Object.keys(CLOUD_ROUTES).find((key) => key.toLowerCase() === folded);
  if (direct) return direct;
  return CLOUD_ALIASES[raw] ?? CLOUD_ALIASES[folded] ?? null;
}

export function cloudFabricStatus() {
  return Object.freeze({
    schemaVersion: 1,
    kind: "evavo-cloud-provider-routing-status-v1",
    routes: CLOUD_ROUTES,
    aliases: CLOUD_ALIASES,
    policy: Object.freeze({
      providerIdentityRequiredBeforeEffects: true,
      credentialValuesReturned: false,
      readBeforeWrite: true,
      writeRequiresPostcondition: true,
      destructiveRequiresSeparateEffectLease: true,
      crossProviderCredentialReuseAllowed: false,
      crossAccountOrProjectSubstitutionAllowed: false,
      localAdapterEffectsRequireLivePhysicalExecution: true,
      providerNativeReadOnlyMayContinueWhenWindowsExecutionIsDegraded: true,
    }),
    capabilityPlane: "EVAVO-STUDIO/evavo-development-studio:config/agent-cloud-provider-capability-plane.json",
    databaseRouter: "EVAVO-STUDIO/evavo-agent-infrastructure:mcp-server/database-provider-routing-mcp.mjs",
  });
}

export function routeCloudProvider(provider) {
  const requestedProvider = typeof provider === "string" ? provider.trim() : "";
  const key = normalizeProvider(provider);
  if (!key || !CLOUD_ROUTES[key]) throw new Error(`unsupported cloud provider: ${requestedProvider || String(provider ?? "")}`);
  return Object.freeze({ schemaVersion: 1, kind: "evavo-cloud-provider-route-v1", requestedProvider, provider: key, ...CLOUD_ROUTES[key] });
}

const tools = Object.freeze([
  Object.freeze({ name: "evavo_cloud_fabric_status", description: "Return evidence-backed EVAVO cloud provider routing state without causing provider effects.", inputSchema: Object.freeze({ type: "object", additionalProperties: false, properties: {} }) }),
  Object.freeze({ name: "evavo_cloud_route", description: "Resolve one cloud provider or common alias to the canonical connected provider or local fallback authority without executing it.", inputSchema: Object.freeze({ type: "object", additionalProperties: false, required: ["provider"], properties: { provider: { enum: [...Object.keys(CLOUD_ROUTES), ...Object.keys(CLOUD_ALIASES)] } } }) }),
]);

function result(id, value) { return { jsonrpc: "2.0", id, result: value }; }
function error(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

export function handleRequest(request) {
  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") return error(request?.id ?? null, -32600, "Invalid Request");
  if (request.method === "server/discover") return result(request.id, { protocolVersion: "2026-07-28", supportedVersions: ["2026-07-28", "2024-11-05"], capabilities: { tools: { listChanged: false } }, serverInfo: { name: "evavo-cloud-provider-routing", version: "1.0.0" }, instructions: "Read-only provider routing. Execute effects only through the returned canonical authority and its provider/account/project identity gates." });
  if (request.method === "initialize") return result(request.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "evavo-cloud-provider-routing", version: "1.0.0" } });
  if (request.method === "notifications/initialized") return null;
  if (request.method === "tools/list") return result(request.id, { tools });
  if (request.method === "tools/call") {
    try {
      if (request.params?.name === "evavo_cloud_fabric_status") return result(request.id, { content: [{ type: "text", text: JSON.stringify(cloudFabricStatus()) }] });
      if (request.params?.name === "evavo_cloud_route") return result(request.id, { content: [{ type: "text", text: JSON.stringify(routeCloudProvider(request.params?.arguments?.provider)) }] });
      return error(request.id, -32601, "Method not found");
    } catch (cause) { return error(request.id, -32602, String(cause?.message ?? cause)); }
  }
  return error(request.id, -32601, "Method not found");
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let response;
    try { response = handleRequest(JSON.parse(line)); } catch { response = error(null, -32700, "Parse error"); }
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}
