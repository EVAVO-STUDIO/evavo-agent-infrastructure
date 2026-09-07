import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const repoRoot = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (value) => value.slice(1)));
const server = join(repoRoot, "mcp-server", "vercel-control-mcp.mjs");
const fixture = mkdtempSync(join(tmpdir(), "evavo-vercel-mcp-"));
mkdirSync(join(fixture, "scripts"), { recursive: true });
mkdirSync(join(fixture, "config"), { recursive: true });
writeFileSync(join(fixture, "config", "vercel-control-policy.json"), JSON.stringify({ schemaVersion: "fixture" }));
writeFileSync(join(fixture, "scripts", "vercel-control.mjs"), `
import process from "node:process";
const chunks=[]; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const request=JSON.parse(Buffer.concat(chunks).toString("utf8"));
const execute=process.argv.includes("--execute");
process.stdout.write(JSON.stringify({schemaVersion:"fixture",status:execute?"completed":"planned",executed:execute,request,credentialAvailable:Boolean(process.env.VERCEL_API_TOKEN||process.env.VERCEL_TOKEN)}));
`);

const child = spawn(process.execPath, [server], {
  env: {
    ...process.env,
    EVAVO_DEVELOPMENT_STUDIO_REPO: fixture,
    VERCEL_API_TOKEN: "fixture-secret-do-not-return",
  },
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
const pending = new Map();
const stderr = [];
child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
(async () => {
  for await (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  }
})();
let id = 0;
function call(method, params) {
  id += 1;
  const current = id;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: current, method, ...(params === undefined ? {} : { params }) })}\n`);
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(`timeout waiting for ${method}`)), 5_000);
    pending.set(current, (message) => { clearTimeout(timer); resolvePromise(message); });
  });
}

try {
  const initialized = await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fixture", version: "1" } });
  assert.equal(initialized.result.serverInfo.name, "evavo-vercel-control-mcp");

  const listed = await call("tools/list", {});
  const names = listed.result.tools.map((tool) => tool.name);
  assert.deepEqual(names, ["evavo_vercel_control_capabilities", "evavo_vercel_control"]);

  const capabilities = await call("tools/call", { name: "evavo_vercel_control_capabilities", arguments: {} });
  const capabilityDoc = JSON.parse(capabilities.result.content[0].text);
  assert.equal(capabilityDoc.ok, true);
  assert.equal(capabilityDoc.credentials.processCredentialPresent, true);
  assert.equal(capabilityDoc.credentialValuesReturned, false);
  assert.doesNotMatch(capabilities.result.content[0].text, /fixture-secret-do-not-return/);

  const planned = await call("tools/call", {
    name: "evavo_vercel_control",
    arguments: { request: { operation: "project.list" }, execute: false },
  });
  const planDoc = JSON.parse(planned.result.content[0].text);
  assert.equal(planDoc.status, "planned");
  assert.equal(planDoc.executed, false);
  assert.equal(planDoc.mcpBridge, "evavo-vercel-control-v1");
  assert.doesNotMatch(planned.result.content[0].text, /fixture-secret-do-not-return/);

  const executed = await call("tools/call", {
    name: "evavo_vercel_control",
    arguments: { request: { operation: "project.list" }, execute: true },
  });
  const executeDoc = JSON.parse(executed.result.content[0].text);
  assert.equal(executeDoc.status, "completed");
  assert.equal(executeDoc.executed, true);
  assert.equal(executeDoc.credentialValuesReturned, false);
  assert.doesNotMatch(executed.result.content[0].text, /fixture-secret-do-not-return/);

  process.stdout.write("vercel control MCP bridge checks passed\n");
} finally {
  child.kill();
}
