import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(resolve(process.cwd(), "..", ".mcp.json"), "utf8"));

describe("Agent Infrastructure project MCP configuration", () => {
  it("launches the exact production Local Agent MCP runtime", () => {
    const server = config.mcpServers["evavo-local-agent-executor"];
    expect(server.command).toBe("node");
    expect(server.args).toEqual(["./mcp-server/local-agent-mcp.mjs"]);
    expect(server.env.EVAVO_LOCAL_AGENT_MCP_CANONICAL_EXECUTOR).toBe("evavo-agent-mcp");
  });

  it("does not advertise the retired raw-shell server as an executor", () => {
    expect(config.mcpServers["evavo-windows-chat-execution"]).toBeUndefined();
    const guide = config.mcpServers["evavo-windows-execution-migration-guide"];
    expect(guide.command).toBe("node");
    expect(guide.args).toEqual(["./mcp-server/windows-chat-execution-mcp.mjs"]);
    expect(guide.env.EVAVO_AGENT_WORKSTATION_EXECUTION_PROVIDER).toBe("evavo-windows-workstation-bridge");
    expect(guide.env.EVAVO_AGENT_WORKSTATION_EXECUTION_STATUS).toBe("legacy-raw-shell-retired");
    expect(guide.env.EVAVO_WINDOWS_CHAT_EXECUTION_ENABLED).toBeUndefined();
    expect(guide.env.EVAVO_WINDOWS_CHAT_ALLOWED_ROOTS).toBeUndefined();
  });
});
