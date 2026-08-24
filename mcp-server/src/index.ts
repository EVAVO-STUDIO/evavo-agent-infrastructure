// The production Local Agent MCP is dependency-free ESM so Claude/local MCP hosts
// can launch it without a build step. Keep the TypeScript package entrypoint as a
// thin delegating shim to guarantee development builds exercise the same runtime.
import "../local-agent-mcp.mjs";
