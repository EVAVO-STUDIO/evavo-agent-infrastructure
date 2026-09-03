import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = resolve(ROOT, "mcp-server", "chatgpt-unified-capability-mcp.mjs");
const CANONICAL_CONFIG = resolve(ROOT, "config", "chatgpt-unified-capability-surface.v1.json");

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "evavo-chatgpt-surface-test-"));
  const catalogPath = resolve(root, "catalog.json");
  writeFileSync(
    catalogPath,
    JSON.stringify({
      schemaVersion: 1,
      kind: "evavo-test-catalog",
      capabilities: [
        {
          id: "optional-server/read_status",
          serverTitle: "Optional server",
          toolName: "read_status",
          title: "Read status",
          description: "Read-only catalog fixture",
          available: false,
          annotations: { readOnlyHint: true },
          inputSchema: { type: "object", additionalProperties: false, properties: {} },
        },
      ],
    }),
  );
  const canonical = JSON.parse(readFileSync(CANONICAL_CONFIG, "utf8"));
  canonical.servers = [];
  canonical.catalog.refreshSeconds = 0;
  canonical.catalog.dynamicCatalogEnvironment = "EVAVO_TEST_CAPABILITY_CATALOG";
  const configPath = resolve(root, "config.json");
  writeFileSync(configPath, JSON.stringify(canonical));
  return { root, configPath, catalogPath };
}

async function client(configPath, catalogPath) {
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      EVAVO_CHATGPT_CAPABILITY_SURFACE_CONFIG: configPath,
      EVAVO_TEST_CAPABILITY_CATALOG: catalogPath,
    },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });
  let nextId = 1;
  const pending = new Map();
  const stderr = [];
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
    const value = JSON.parse(line);
    const waiter = pending.get(value.id);
    if (!waiter) return;
    pending.delete(value.id);
    clearTimeout(waiter.timer);
    waiter.resolve(value);
  });
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  function request(method, params = {}) {
    const id = nextId++;
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectRequest(new Error(`request timed out: ${method}; stderr=${stderr.join("").slice(-1000)}`));
      }, 5000);
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  return {
    child,
    request,
    close() {
      child.kill();
    },
  };
}

function structured(callResponse) {
  return callResponse.result.structuredContent;
}

test("canonical contract is safe and forward compatible", () => {
  const value = JSON.parse(readFileSync(CANONICAL_CONFIG, "utf8"));
  assert.equal(value.kind, "evavo-chatgpt-unified-capability-surface-v1");
  assert.equal(value.status, "canonical");
  assert.equal(value.server.id, "evavo-fabric");
  assert.ok(value.server.compatibilityAliases.includes("evavo-fleet-readonly"));
  assert.ok(value.stableTools.includes("evavo_capabilities"));
  assert.ok(value.stableTools.includes("evavo_capability_invoke"));
  assert.equal(value.sessionContinuity.newCapabilityDoesNotRequireNewTopLevelTool, true);
  assert.equal(value.sessionContinuity.existingAttachedChatCanDiscoverNewCapabilityThroughCatalog, true);
  assert.equal(value.sessionContinuity.unattachedChatCannotBeMutatedByRepositoryCode, true);
  assert.equal(value.routing.arbitraryShellAccepted, false);
  assert.equal(value.routing.rawPowerShellAccepted, false);
  assert.equal(value.routing.callerSelectedExecutableAccepted, false);
  assert.equal(value.routing.callerSelectedScriptSourceAccepted, false);
  assert.equal(value.routing.automaticReplayOfUncertainEffect, false);
  assert.equal(value.relay.githubActionsRequired, false);
  assert.equal(value.relay.vercelRequired, false);
  assert.equal(value.evidence.issueClosureIsExecutionProof, false);
});

test("server exposes stable tools and dynamic catalog to an existing attached chat", async () => {
  const value = fixture();
  const connection = await client(value.configPath, value.catalogPath);
  try {
    const initialized = await connection.request("initialize", {
      protocolVersion: "2026-07-28",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    assert.equal(initialized.result.serverInfo.name, "evavo-fabric");
    assert.match(initialized.result.instructions, /evavo_capabilities/);

    const discovered = await connection.request("server/discover", {
      _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
    });
    assert.ok(discovered.result.supportedVersions.includes("2026-07-28"));

    const listed = await connection.request("tools/list");
    const names = listed.result.tools.map((tool) => tool.name);
    for (const required of [
      "evavo_capabilities",
      "evavo_capability_describe",
      "evavo_capability_refresh",
      "evavo_capability_invoke",
      "evavo_surface_status",
      "evavo_relay_prepare",
      "evavo_fleet_capabilities",
      "fleet_capabilities",
    ]) {
      assert.ok(names.includes(required), required);
    }

    const catalogCall = await connection.request("tools/call", {
      name: "evavo_capabilities",
      arguments: { limit: 20 },
    });
    const catalog = structured(catalogCall);
    assert.equal(catalog.kind, "evavo-chatgpt-capability-catalog-v1");
    assert.equal(catalog.allCapabilitiesDiscoverableThroughStableRouter, true);
    assert.equal(catalog.newCapabilityRequiresNewChatTool, false);
    assert.equal(catalog.capabilityCount, 1);
    assert.equal(catalog.capabilities[0].id, "optional-server/read_status");
    assert.equal(catalog.capabilities[0].available, false);

    const aliasCall = await connection.request("tools/call", {
      name: "evavo_fleet_capabilities",
      arguments: { query: "status" },
    });
    assert.equal(structured(aliasCall).capabilities.length, 1);

    const description = await connection.request("tools/call", {
      name: "evavo_capability_describe",
      arguments: { capabilityId: "optional-server/read_status" },
    });
    assert.equal(structured(description).capability.effect, "read");

    const status = await connection.request("tools/call", {
      name: "evavo_surface_status",
      arguments: {},
    });
    assert.equal(structured(status).stableRouterAvailable, true);
    assert.equal(structured(status).githubRelayFallbackPrepared, true);
    assert.equal(structured(status).unattachedChatsRequireWorkspaceAppOrGithubFallback, true);

    const resources = await connection.request("resources/list");
    assert.ok(resources.result.resources.some((item) => item.uri === "evavo://capabilities"));
    const resource = await connection.request("resources/read", { uri: "evavo://capabilities" });
    assert.match(resource.result.contents[0].text, /optional-server\/read_status/);
  } finally {
    connection.close();
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("router rejects unknown and unavailable capabilities without execution", async () => {
  const value = fixture();
  const connection = await client(value.configPath, value.catalogPath);
  try {
    const unknown = await connection.request("tools/call", {
      name: "evavo_capability_invoke",
      arguments: { capabilityId: "missing/tool", arguments: {}, mode: "inspect" },
    });
    assert.equal(unknown.result.isError, true);
    assert.match(structured(unknown).error, /Unknown capability ID/);

    const unavailable = await connection.request("tools/call", {
      name: "evavo_capability_invoke",
      arguments: {
        capabilityId: "optional-server/read_status",
        arguments: {},
        mode: "inspect",
      },
    });
    assert.equal(unavailable.result.isError, true);
    assert.match(structured(unavailable).error, /currently unavailable/);
  } finally {
    connection.close();
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("relay preparation is typed, prepare-only and contains no raw command field", async () => {
  const value = fixture();
  const connection = await client(value.configPath, value.catalogPath);
  try {
    const prepared = await connection.request("tools/call", {
      name: "evavo_relay_prepare",
      arguments: {
        capabilityId: "optional-server/read_status",
        arguments: {},
        intent: "Read the current admitted status safely",
        requestId: "chatgpt-safe-relay-test-0001",
      },
    });
    const receipt = structured(prepared);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.prepareOnly, true);
    assert.equal(receipt.executionNotClaimed, true);
    assert.equal(receipt.capabilityId, "optional-server/read_status");
    assert.match(receipt.body, /evavo-capability-dispatch-v1/);
    assert.doesNotMatch(receipt.body, /"command"\s*:/);
    assert.doesNotMatch(receipt.body, /"executable"\s*:/);
    assert.doesNotMatch(receipt.body, /"script"\s*:/);
  } finally {
    connection.close();
    rmSync(value.root, { recursive: true, force: true });
  }
});
