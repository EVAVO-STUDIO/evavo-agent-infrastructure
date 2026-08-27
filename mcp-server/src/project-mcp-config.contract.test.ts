import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(resolve(process.cwd(), "..", ".mcp.json"), "utf8"));
const servers = config.mcpServers;

const bridgeExecutable = "../evavo-local-compute/.venv/Scripts/evavo-windows-workstation-bridge.exe";

describe("Agent Infrastructure project MCP configuration", () => {
  it("launches the exact production Local Agent MCP runtime", () => {
    const server = servers["evavo-local-agent-executor"];
    expect(server.command).toBe("node");
    expect(server.args).toEqual(["./mcp-server/local-agent-mcp.mjs"]);
    expect(server.env.EVAVO_LOCAL_AGENT_MCP_CANONICAL_EXECUTOR).toBe("evavo-agent-mcp");
  });

  it("registers the real structured Workstation Bridge for normal host work", () => {
    const bridge = servers["evavo-windows-workstation-bridge"];
    expect(bridge.command).toBe(bridgeExecutable);
    expect(bridge.args).toEqual(["mcp"]);
    expect(bridge.env.EVAVO_LOCAL_EXECUTION_MCP_ENABLED).toBe("enabled");
    expect(bridge.env.EVAVO_LOCAL_SCRIPT_EXECUTION_ENABLED).toBe("enabled");
    expect(bridge.env.EVAVO_LOCAL_REPOSITORY_CODE_ENABLED).toBe("enabled");
    expect(bridge.env.EVAVO_LOCAL_FILESYSTEM_WRITE_ENABLED).toBe("enabled");
    expect(bridge.env.EVAVO_LOCAL_GIT_MUTATION_ENABLED).toBe("enabled");
    expect(bridge.env.EVAVO_LOCAL_NETWORK_ENABLED).toBe("disabled");
    expect(bridge.env.EVAVO_LOCAL_CONTAINER_ENABLED).toBe("disabled");
    expect(bridge.env.EVAVO_LOCAL_ARCHIVE_ENABLED).toBe("disabled");
  });

  it("keeps broader network and archive authority behind an explicit operator profile", () => {
    const operator = servers["evavo-windows-workstation-operator"];
    expect(operator.command).toBe(bridgeExecutable);
    expect(operator.args).toEqual(["mcp"]);
    expect(operator.env.EVAVO_WINDOWS_OPERATOR_PROFILE).toBe("enabled");
    expect(operator.env.EVAVO_LOCAL_NETWORK_ENABLED).toBe("enabled");
    expect(operator.env.EVAVO_LOCAL_ARCHIVE_ENABLED).toBe("enabled");
    expect(operator.env.EVAVO_LOCAL_CONTAINER_ENABLED).toBe("disabled");
  });

  it("does not advertise the retired raw-shell server as an executor", () => {
    expect(servers["evavo-windows-chat-execution"]).toBeUndefined();
    const guide = servers["evavo-windows-execution-migration-guide"];
    expect(guide.command).toBe("node");
    expect(guide.args).toEqual(["./mcp-server/windows-chat-execution-mcp.mjs"]);
    expect(guide.env.EVAVO_AGENT_WORKSTATION_EXECUTION_PROVIDER).toBe("evavo-windows-workstation-bridge");
    expect(guide.env.EVAVO_AGENT_WORKSTATION_EXECUTION_STATUS).toBe("legacy-raw-shell-retired");
    expect(guide.env.EVAVO_WINDOWS_CHAT_EXECUTION_ENABLED).toBeUndefined();
    expect(guide.env.EVAVO_WINDOWS_CHAT_ALLOWED_ROOTS).toBeUndefined();
  });

  it("does not expose the internal mutation backend as a peer MCP", () => {
    expect(servers["evavo-local-execution"]).toBeUndefined();
  });
});
