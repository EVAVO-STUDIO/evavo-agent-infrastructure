import test from "node:test";
import assert from "node:assert/strict";

import {
  DATABASE_ALIASES,
  DATABASE_ROUTES,
  databaseFabricStatus,
  routeDatabaseTask,
  handleRequest,
} from "../mcp-server/database-provider-routing-mcp.mjs";

test("database fabric exposes proven provider and sandbox routes", () => {
  const status = databaseFabricStatus();
  assert.equal(status.kind, "evavo-database-provider-routing-status-v1");
  assert.equal(status.routes.firebase.state, "provider-auth-project-inventory-and-cli-15.28.1-proven");
  assert.equal(status.routes.mongodb.state, "local-sandbox-and-mongosh-2.10.0-proven-external-provider-profile-pending");
  assert.equal(status.routes.postgresql.state, "postgres17-sandbox-write-read-proven");
  assert.equal(status.mutationPolicy.blindRetryAfterUnknownWrite, false);
  assert.equal(status.aliases.mongo, "mongodb");
});

test("database route is deterministic and rejects unknown engines", () => {
  assert.equal(routeDatabaseTask("supabase").authority, "provider-native:Supabase");
  assert.equal(routeDatabaseTask("postgres").engine, "postgresql");
  assert.equal(routeDatabaseTask("mongo").engine, "mongodb");
  assert.equal(routeDatabaseTask("firestore").engine, "firebase");
  assert.equal(routeDatabaseTask("neon").engine, "neonPostgres");
  assert.equal(routeDatabaseTask("sqlite3").engine, "sqlite");
  assert.throws(() => routeDatabaseTask("oracle"), /unsupported database engine/u);
});

test("MCP serves modern discovery while preserving legacy initialization", () => {
  const discovery = handleRequest({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} });
  assert.equal(discovery.result.protocolVersion, "2026-07-28");
  assert.ok(discovery.result.supportedVersions.includes("2024-11-05"));
  const initialize = handleRequest({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} });
  assert.equal(initialize.result.protocolVersion, "2024-11-05");
});

test("MCP tool list exactly exposes read-only routing tools", () => {
  const response = handleRequest({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
  assert.deepEqual(response.result.tools.map((tool) => tool.name).sort(), ["evavo_database_fabric_status", "evavo_database_route"]);
  assert.deepEqual(Object.keys(DATABASE_ROUTES).sort(), ["duckdb", "firebase", "mariadb", "mongodb", "mysql", "neonPostgres", "postgresql", "redis", "sqlite", "supabase"]);
  assert.ok(Object.keys(DATABASE_ALIASES).includes("postgres"));
  assert.ok(Object.keys(DATABASE_ALIASES).includes("mongo"));
});
