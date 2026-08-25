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
});
