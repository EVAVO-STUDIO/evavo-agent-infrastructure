import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("remote MCP exposes only read-only workstation tools", () => {
  assert.match(source, /workstation_status/);
  assert.match(source, /workstation_capabilities/);
  assert.match(source, /readOnlyHint:\s*true/g);
  assert.doesNotMatch(source, /registerTool\(\s*["'](?:dispatch|execute|powershell|shell)/i);
  assert.match(source, /dispatchExposedThroughProMcp:\s*false/);
});

test("effectful dispatch is separately authenticated and typed", () => {
  assert.match(source, /\/api\/dispatch/);
  assert.match(source, /DISPATCH_TOKEN/);
  assert.match(source, /ALLOWED_DISPATCH_ACTIONS/);
  assert.match(source, /action-not-admitted/);
  assert.doesNotMatch(source, /ALLOWED_DISPATCH_ACTIONS[\s\S]*powershell\.command/i);
  assert.doesNotMatch(source, /ALLOWED_DISPATCH_ACTIONS[\s\S]*shell\.command/i);
});

test("workstation connection is outbound websocket with independent token", () => {
  assert.match(source, /\/connect/);
  assert.match(source, /WORKSTATION_TOKEN/);
  assert.match(source, /acceptWebSocket\(server, \["workstation"\]\)/);
  assert.match(source, /getWebSockets\("workstation"\)/);
});

test("Cloudflare config uses a SQLite Durable Object", () => {
  assert.match(wrangler, /"WORKSTATION_RELAY"/);
  assert.match(wrangler, /"WorkstationRelay"/);
  assert.match(wrangler, /"new_sqlite_classes"/);
  assert.doesNotMatch(wrangler, /kv_namespaces/i);
});

test("documentation keeps local executors private and plan boundaries explicit", () => {
  assert.match(readme, /REST Executor v5 and Local Agent remain loopback-only/);
  assert.match(readme, /ChatGPT Pro custom MCP access is limited to read\/fetch permissions/);
  assert.match(readme, /No raw PowerShell or arbitrary command string/);
  assert.match(readme, /paid overage is not a required recovery assumption/);
});
