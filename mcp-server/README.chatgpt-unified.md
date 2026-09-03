# EVAVO Fabric MCP server

Launch from the repository root:

```text
node mcp-server/chatgpt-unified-capability-mcp.mjs
```

The canonical registration is `config/chatgpt-unified-mcp-registration.v1.json`.

The server keeps a small stable ChatGPT tool set while dynamically cataloguing and routing admitted child MCP tools. It is designed to replace the implementation behind the existing `evavo-fleet-readonly` connection rather than create a competing app identity.

The default child is `mcp-server/local-agent-mcp-v2.mjs`. Its execution and receipt authorities remain unchanged.
