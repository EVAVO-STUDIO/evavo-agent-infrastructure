#!/usr/bin/env node

import { createInterface } from "node:readline";

export const DATABASE_ROUTES = Object.freeze({
  supabase: Object.freeze({ authority: "provider-native:Supabase", state: "provider-read-sql-and-diagnostic-proven", production: true }),
  neonPostgres: Object.freeze({ authority: "provider-native:Neon_Postgres", state: "provider-admin-visibility-proven-sql-wrapper-inconsistent", production: true }),
  firebase: Object.freeze({ authority: "EVAVO-STUDIO/evavo-local-compute:firebase-admin-cli", state: "provider-auth-project-inventory-and-cli-15.28.1-proven", production: true }),
  mongodb: Object.freeze({ authority: "EVAVO-STUDIO/evavo-local-compute:mongodb", state: "local-sandbox-and-mongosh-2.10.0-proven-external-provider-profile-pending", production: false }),
  postgresql: Object.freeze({ authority: "provider-first:Supabase-or-Neon;fallback:EVAVO-STUDIO/evavo-local-compute", state: "postgres17-sandbox-write-read-proven", production: true }),
  redis: Object.freeze({ authority: "EVAVO-STUDIO/evavo-local-compute:database-sandbox", state: "redis7-sandbox-write-read-proven", production: false }),
  mysql: Object.freeze({ authority: "EVAVO-STUDIO/evavo-local-compute:database-sandbox", state: "mysql8.4-sandbox-write-read-proven", production: false }),
  mariadb: Object.freeze({ authority: "EVAVO-STUDIO/evavo-local-compute:database-sandbox", state: "mariadb11-sandbox-write-read-proven", production: false }),
  sqlite: Object.freeze({ authority: "EVAVO-STUDIO/evavo-local-compute:python-sqlite3", state: "sqlite3-local-write-read-proven", production: false }),
  duckdb: Object.freeze({ authority: "EVAVO-STUDIO/evavo-local-compute:disposable-analytics-runtime", state: "duckdb1.5.5-write-read-proven", production: false }),
});

export const DATABASE_ALIASES = Object.freeze({
  postgres: "postgresql",
  pg: "postgresql",
  "postgresql-17": "postgresql",
  neon: "neonPostgres",
  "neon-postgres": "neonPostgres",
  mongo: "mongodb",
  atlas: "mongodb",
  "mongodb-atlas": "mongodb",
  firestore: "firebase",
  "firebase-firestore": "firebase",
  "supabase-postgres": "supabase",
  "mysql8": "mysql",
  "maria-db": "mariadb",
  "redis7": "redis",
  "sqlite3": "sqlite",
  "duck-db": "duckdb",
});

function normalizeEngine(engine) {
  if (typeof engine !== "string" || !engine.trim()) throw new Error("engine is required");
  const requested = engine.trim();
  if (DATABASE_ROUTES[requested]) return requested;
  const folded = requested.toLowerCase();
  if (DATABASE_ROUTES[folded]) return folded;
  return DATABASE_ALIASES[requested] ?? DATABASE_ALIASES[folded] ?? null;
}

export function databaseFabricStatus() {
  return Object.freeze({
    schemaVersion: 1,
    kind: "evavo-database-provider-routing-status-v1",
    routes: DATABASE_ROUTES,
    aliases: DATABASE_ALIASES,
    mutationPolicy: Object.freeze({
      readBeforeWrite: true,
      providerIdentityRequired: true,
      credentialValuesReturned: false,
      productionDdlUsesMigrationOrBranchWorkflow: true,
      unknownSchemaChangesUseSandboxOrProviderBranch: true,
      destructiveOperationsRequireSeparateEffectLease: true,
      postconditionVerificationRequired: true,
      blindRetryAfterUnknownWrite: false,
    }),
    sandboxRegistry: "EVAVO-STUDIO/evavo-local-compute:config/database-sandbox-registry-v1.json",
    planningAuthority: "EVAVO-STUDIO/the-brain:config/database-provider-routing-v1.json",
    connectorCatalog: "EVAVO-STUDIO/evavo-development-studio:config/agent-automation-connectors.json",
  });
}

export function routeDatabaseTask(engine) {
  const requestedEngine = typeof engine === "string" ? engine.trim() : "";
  const key = normalizeEngine(engine);
  if (!key || !DATABASE_ROUTES[key]) throw new Error(`unsupported database engine: ${requestedEngine || String(engine ?? "")}`);
  return Object.freeze({ schemaVersion: 1, kind: "evavo-database-provider-route-v1", requestedEngine, engine: key, ...DATABASE_ROUTES[key] });
}

export const toolDefinitions = Object.freeze([
  Object.freeze({
    name: "evavo_database_fabric_status",
    description: "Return the evidence-backed EVAVO database provider and sandbox routing state without performing database work.",
    inputSchema: Object.freeze({ type: "object", additionalProperties: false, properties: {} }),
  }),
  Object.freeze({
    name: "evavo_database_route",
    description: "Resolve one database engine or common provider alias to its canonical provider or sandbox authority without executing it.",
    inputSchema: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: ["engine"],
      properties: { engine: { enum: [...Object.keys(DATABASE_ROUTES), ...Object.keys(DATABASE_ALIASES)] } },
    }),
  }),
]);

function result(id, value) { return { jsonrpc: "2.0", id, result: value }; }
function error(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

export function handleRequest(request) {
  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") return error(request?.id ?? null, -32600, "Invalid Request");
  if (request.method === "server/discover") {
    return result(request.id, {
      protocolVersion: "2026-07-28",
      supportedVersions: ["2026-07-28", "2024-11-05"],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "evavo-database-provider-routing", version: "1.1.0" },
      instructions: "Read-only routing surface. Execute database work through the returned canonical authority.",
    });
  }
  if (request.method === "initialize") {
    return result(request.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "evavo-database-provider-routing", version: "1.1.0" },
    });
  }
  if (request.method === "notifications/initialized") return null;
  if (request.method === "tools/list") return result(request.id, { tools: toolDefinitions });
  if (request.method === "tools/call") {
    const name = request.params?.name;
    try {
      if (name === "evavo_database_fabric_status") return result(request.id, { content: [{ type: "text", text: JSON.stringify(databaseFabricStatus()) }] });
      if (name === "evavo_database_route") return result(request.id, { content: [{ type: "text", text: JSON.stringify(routeDatabaseTask(request.params?.arguments?.engine)) }] });
      return error(request.id, -32601, "Method not found");
    } catch (cause) {
      return error(request.id, -32602, String(cause?.message ?? cause));
    }
  }
  return error(request.id, -32601, "Method not found");
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let response;
    try { response = handleRequest(JSON.parse(line)); }
    catch { response = error(null, -32700, "Parse error"); }
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}
