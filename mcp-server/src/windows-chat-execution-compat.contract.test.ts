import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.resolve(here, "..", "windows-chat-execution-mcp.mjs");

function run(messages: readonly unknown[]) {
  const input = `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`;
  const result = spawnSync(process.execPath, [server], {
    input,
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, LOCALAPPDATA: path.resolve(here, ".missing-local-app-data") },
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  return result.stdout
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("retired Windows chat execution compatibility MCP", () => {
  it("discovers only read-only compatibility tools", () => {
    const [initialize, listing] = run([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2026-07-28" } },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ]);

    expect(initialize.result.serverInfo.name).toBe("evavo-windows-chat-execution-mcp");
    expect(initialize.result.serverInfo.version).toBe("2.0.0");
    const tools = listing.result.tools;
    const names = tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual([
      "evavo_windows_execution_doctor",
      "evavo_windows_execution_route",
    ]);
    for (const tool of tools) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
      expect(tool._meta["io.evavo/arbitraryCommandTextAccepted"]).toBe(false);
      expect(tool._meta["io.evavo/inlineCodeAccepted"]).toBe(false);
    }
  });

  it("fails closed when an old caller invokes raw execution by name", () => {
    const [response] = run([
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "evavo_windows_execute",
          arguments: {},
        },
      },
    ]);

    expect(response.result.isError).toBe(true);
    expect(response.result.structuredContent.ok).toBe(false);
    expect(response.result.structuredContent.reason).toBe(
      "raw-chat-shell-authority-retired",
    );
    expect(response.result.structuredContent.executionPerformed).toBe(false);
    expect(response.result.structuredContent.arbitraryCommandTextAccepted).toBe(false);
    expect(response.result.structuredContent.inlineCodeAccepted).toBe(false);
    expect(response.result.structuredContent.use.sameMachineExecution).toBe(
      "evavo-local-execution",
    );
    expect(response.result.structuredContent.use.cloudStatus).toBe(
      "evavo-windows-workstation-bridge",
    );
  });

  it("returns the canonical migration route without mutation", () => {
    const [response] = run([
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "evavo_windows_execution_route", arguments: {} },
      },
    ]);

    const route = response.result.structuredContent;
    expect(response.result.isError).toBe(false);
    expect(route.legacyRawShellExecutionRemoved).toBe(true);
    expect(route.canonical.workstationBridge).toBe(
      "evavo-windows-workstation-bridge",
    );
    expect(route.canonical.directChatGptTransport).toBe(
      "openai-secure-mcp-tunnel",
    );
    expect(route.canonical.sameMachineExecutionEngine).toBe(
      "evavo-local-execution",
    );
    expect(route.canonical.effectfulCloudFallback).toBe(
      "github-local-execution-issue-queue",
    );
    expect(route.authority.arbitraryCommandTextAccepted).toBe(false);
    expect(route.authority.inlineCodeAccepted).toBe(false);
    expect(route.physicalWindowsReadinessClaimed).toBe(false);
  });
});
