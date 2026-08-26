import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const deploy = readFileSync(new URL("../../../scripts/Deploy-EvavoRemoteMcpRelay.ps1", import.meta.url), "utf8");

test("remote MCP exposes only read-only workstation tools", () => {
  assert.match(source, /workstation_status/);
  assert.match(source, /workstation_capabilities/);
  assert.match(source, /workstation_request_status/);
  assert.match(source, /readOnlyHint:\s*true/g);
  assert.doesNotMatch(source, /registerTool\(\s*["'](?:dispatch|execute|powershell|shell)/i);
  assert.match(source, /dispatchExposedThroughProMcp:\s*false/);
});

test("MCP v2 tool schemas use raw Zod shapes", () => {
  assert.match(source, /inputSchema:\s*\{\s*requestId:\s*z\.string\(\)\.uuid\(\)\s*\}/);
  assert.doesNotMatch(source, /inputSchema:\s*z\.object/);
  assert.equal(packageJson.dependencies["@modelcontextprotocol/server"], "2.0.0");
  assert.equal(packageJson.dependencies.agents, "^0.21.0");
});

test("effectful dispatch is separately authenticated and typed", () => {
  assert.match(source, /\/api\/dispatch/);
  assert.match(source, /DISPATCH_TOKEN/);
  assert.match(source, /const ACTIONS = new Set/);
  assert.match(source, /action-not-admitted/);
  assert.doesNotMatch(source, /powershell\.command/i);
  assert.doesNotMatch(source, /shell\.command/i);
});

test("workstation connection is outbound hibernating websocket with independent token", () => {
  assert.match(source, /\/connect/);
  assert.match(source, /WORKSTATION_TOKEN/);
  assert.match(source, /acceptWebSocket\(server, \["workstation"\]\)/);
  assert.match(source, /getWebSockets\("workstation"\)/);
  assert.match(source, /serializeAttachment/);
  assert.match(source, /new Request\("https:\/\/relay\.internal\/connect", \{ method: "GET", headers: request\.headers \}\)/);
});

test("request history is explicitly bounded without unsupported storage TTL options", () => {
  assert.match(source, /MAX_STORED_REQUESTS = 256/);
  assert.match(source, /request-index/);
  assert.match(source, /storage\.delete/);
  assert.doesNotMatch(source, /expirationTtl/);
});

test("Cloudflare config deploys the compile-safe Worker and SQLite Durable Object", () => {
  assert.match(wrangler, /"main": "src\/worker\.ts"/);
  assert.match(wrangler, /"WORKSTATION_RELAY"/);
  assert.match(wrangler, /"WorkstationRelay"/);
  assert.match(wrangler, /"new_sqlite_classes"/);
  assert.doesNotMatch(wrangler, /kv_namespaces/i);
});

test("deployment requires a live workstation connection when client installation is requested", () => {
  assert.match(deploy, /EVAVO_REMOTE_MCP_RELAY_DEPLOY_WORKSTATION_DID_NOT_CONNECT/);
  assert.match(deploy, /workstationOnline/);
  assert.match(deploy, /physicalWorkstationConnectionProven=\$ConnectionProven/);
  assert.match(deploy, /dispatchCallerCredentialProvisioned=\$false/);
  assert.match(deploy, /effectfulDispatchReadyForExternalCaller=\$false/);
  assert.doesNotMatch(deploy, /\$LASTEXITCODE\s*-ne\s*0\s*-or\s*-not\s*\$InstallResult/);
  assert.match(deploy, /WorkstationToken \$Secure -StartNow/);
});

test("deployment keeps generated relay secrets out of receipts", () => {
  assert.match(deploy, /workstationSecretReturned=\$false/);
  assert.match(deploy, /dispatchSecretReturned=\$false/);
  assert.match(deploy, /wrangler secret put/);
  assert.doesNotMatch(deploy, /Write-Host\s+\$WorkstationSecret/i);
  assert.doesNotMatch(deploy, /Write-Host\s+\$DispatchSecret/i);
});

test("documentation keeps local executors private and plan boundaries explicit", () => {
  assert.match(readme, /REST Executor v5 and Local Agent remain loopback-only/);
  assert.match(readme, /ChatGPT Pro custom MCP access is limited to read\/fetch permissions/);
  assert.match(readme, /No raw PowerShell or arbitrary command string/);
  assert.match(readme, /paid overage is not a required recovery assumption/);
});
