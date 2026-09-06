import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = resolve(ROOT, "mcp-server", "chatgpt-unified-capability-entry.mjs");
const CONFIG = resolve(ROOT, "config", "chatgpt-unified-capability-surface.v1.json");
const REGISTRATION = resolve(ROOT, "config", "chatgpt-unified-mcp-registration.v1.json");

function request(child, method, params = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const id = 1;
    const stderr = [];
    const timer = setTimeout(() => {
      rejectRequest(new Error(`request timed out: ${method}; stderr=${stderr.join("").slice(-1000)}`));
    }, 5000);
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
    reader.on("line", (line) => {
      const value = JSON.parse(line);
      if (value.id !== id) return;
      clearTimeout(timer);
      reader.close();
      resolveRequest(value);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

test("canonical registration launches schema 2 through the compatibility entrypoint", async () => {
  const config = JSON.parse(readFileSync(CONFIG, "utf8"));
  const registration = JSON.parse(readFileSync(REGISTRATION, "utf8"));
  assert.equal(config.schemaVersion, 2);
  assert.equal(config.kind, "evavo-chatgpt-unified-capability-surface-v1");
  assert.equal(config.status, "canonical");
  assert.deepEqual(registration.mcpServers["evavo-fabric"].args, [
    "mcp-server/chatgpt-unified-capability-entry.mjs",
  ]);

  const child = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    env: {
      ...process.env,
      EVAVO_CHATGPT_CAPABILITY_SURFACE_CONFIG: CONFIG,
    },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });
  try {
    const initialized = await request(child, "initialize", {
      protocolVersion: "2026-07-28",
      capabilities: {},
      clientInfo: { name: "schema-2-entry-test", version: "1" },
    });
    assert.equal(initialized.result.serverInfo.name, "evavo-fabric");
    assert.match(initialized.result.instructions, /evavo_capabilities/);
  } finally {
    child.kill();
  }
});

test("entrypoint rejects unsupported schema versions before loading the capability server", async () => {
  const source = readFileSync(ENTRY, "utf8");
  assert.match(source, /SUPPORTED_SCHEMA_VERSIONS = new Set\(\[1, 2\]\)/);
  assert.match(source, /value\.kind !== EXPECTED_KIND/);
  assert.match(source, /value\.status !== "canonical"/);
});
