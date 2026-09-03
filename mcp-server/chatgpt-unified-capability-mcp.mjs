#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve, dirname, isAbsolute, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CONFIG_PATH = resolve(
  process.env.EVAVO_CHATGPT_CAPABILITY_SURFACE_CONFIG ||
    resolve(ROOT, "config", "chatgpt-unified-capability-surface.v1.json"),
);
const SERVER_NAME = "evavo-fabric";
const SERVER_VERSION = "1.0.0";
const DEFAULT_PROTOCOL = "2026-07-28";
const REQUEST_TIMEOUT_MS = 20_000;
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SECRET_KEY = /(authorization|bearer|cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key)/i;

function fail(message, code = -32603, data = undefined) {
  const error = new Error(message);
  error.rpcCode = code;
  error.rpcData = data;
  return error;
}

function regularFile(path, label) {
  const full = resolve(path);
  let stat;
  try {
    stat = statSync(full, { throwIfNoEntry: true });
  } catch {
    throw fail(`${label} is unavailable`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw fail(`${label} must be a regular non-symbolic file`);
  }
  return full;
}

function loadJson(path, label) {
  const full = regularFile(path, label);
  let value;
  try {
    value = JSON.parse(readFileSync(full, "utf8"));
  } catch {
    throw fail(`${label} is invalid JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw fail(`${label} must be an object`);
  }
  return value;
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw fail(`${label} must be an object`, -32602);
  }
  return value;
}

function boundedJson(value, maximumBytes, maximumDepth) {
  const seen = new Set();
  function visit(current, depth) {
    if (depth > maximumDepth) throw fail("JSON payload exceeds maximum depth", -32602);
    if (current === null || ["string", "number", "boolean"].includes(typeof current)) return;
    if (typeof current !== "object") throw fail("JSON payload contains an unsupported value", -32602);
    if (seen.has(current)) throw fail("JSON payload must not contain cycles", -32602);
    seen.add(current);
    if (Array.isArray(current)) {
      if (current.length > 4096) throw fail("JSON array is too large", -32602);
      for (const child of current) visit(child, depth + 1);
    } else {
      const entries = Object.entries(current);
      if (entries.length > 4096) throw fail("JSON object is too large", -32602);
      for (const [key, child] of entries) {
        if (FORBIDDEN_OBJECT_KEYS.has(key)) throw fail("JSON payload contains a forbidden key", -32602);
        visit(child, depth + 1);
      }
    }
    seen.delete(current);
  }
  visit(value, 0);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > maximumBytes) {
    throw fail("JSON payload exceeds maximum bytes", -32602);
  }
  return value;
}

function redactSecrets(value, key = "") {
  if (value === null || ["number", "boolean"].includes(typeof value)) return value;
  if (typeof value === "string") return SECRET_KEY.test(key) ? "<redacted>" : value;
  if (Array.isArray(value)) return value.map((child) => redactSecrets(child, key));
  if (typeof value === "object") {
    const output = {};
    for (const [childKey, child] of Object.entries(value)) {
      if (FORBIDDEN_OBJECT_KEYS.has(childKey)) continue;
      output[childKey] = redactSecrets(child, childKey);
    }
    return output;
  }
  return String(value);
}

function safeName(value) {
  const cleaned = String(value)
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72);
  return cleaned || "tool";
}

function withinRoot(path, root = ROOT) {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function content(payload, isError = false) {
  const safe = redactSecrets(payload);
  return {
    content: [{ type: "text", text: JSON.stringify(safe) }],
    structuredContent: safe,
    isError,
  };
}

function response(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id, error) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code: Number.isInteger(error?.rpcCode) ? error.rpcCode : -32603,
      message: String(error?.message || "Internal error").slice(0, 2000),
      ...(error?.rpcData === undefined ? {} : { data: redactSecrets(error.rpcData) }),
    },
  };
}

class ChildMcp {
  constructor(definition, config) {
    this.definition = definition;
    this.config = config;
    this.process = null;
    this.reader = null;
    this.pending = new Map();
    this.nextId = 1;
    this.initialized = false;
    this.tools = [];
    this.error = null;
    this.stderrTail = "";
  }

  resolveCommand() {
    const command = String(this.definition.command || "").trim();
    if (!command) throw fail(`MCP server ${this.definition.id} has no command`);
    if (command === "node" || command === "node.exe") return process.execPath;
    if (isAbsolute(command)) {
      if (!withinRoot(command) && this.definition.allowExternalExecutable !== true) {
        throw fail(`MCP server ${this.definition.id} executable is outside the admitted root`);
      }
      return regularFile(command, `MCP server ${this.definition.id} executable`);
    }
    if (this.definition.allowPathLookup !== true) {
      throw fail(`MCP server ${this.definition.id} PATH lookup is not admitted`);
    }
    return command;
  }

  resolvedArguments() {
    const argumentsValue = Array.isArray(this.definition.arguments) ? this.definition.arguments : [];
    return argumentsValue.map((argument, index) => {
      const value = String(argument);
      if (index === 0 && /[\\/]mcp-server[\\/].+\.mjs$/i.test(value)) {
        const full = resolve(ROOT, value);
        if (!withinRoot(full)) throw fail(`MCP server ${this.definition.id} source escaped its repository`);
        return regularFile(full, `MCP server ${this.definition.id} source`);
      }
      if (value.includes("\u0000")) throw fail(`MCP server ${this.definition.id} argument is invalid`);
      return value;
    });
  }

  async start() {
    if (this.process && !this.process.killed) return;
    const command = this.resolveCommand();
    const args = this.resolvedArguments();
    const cwd = resolve(ROOT, String(this.definition.workingDirectory || "."));
    if (!withinRoot(cwd)) throw fail(`MCP server ${this.definition.id} working directory escaped its repository`);
    const env = {
      ...process.env,
      ...(this.definition.environment || {}),
      EVAVO_PARENT_MCP_SERVER: SERVER_NAME,
    };
    this.process = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    this.process.on("exit", (code, signal) => {
      const reason = `MCP server ${this.definition.id} exited (${code ?? "null"}/${signal ?? "none"})`;
      this.error = reason;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(fail(reason));
      }
      this.pending.clear();
      this.process = null;
      this.initialized = false;
      this.tools = [];
    });
    this.process.stderr.on("data", (chunk) => {
      this.stderrTail = `${this.stderrTail}${String(chunk)}`.slice(-8000);
    });
    this.reader = createInterface({ input: this.process.stdout, crlfDelay: Infinity });
    this.reader.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message && Object.prototype.hasOwnProperty.call(message, "id")) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(fail(String(message.error.message || "Child MCP error"), message.error.code, message.error.data));
        else pending.resolve(message.result);
      }
    });
    await new Promise((resolveReady, rejectReady) => {
      const timer = setTimeout(resolveReady, 25);
      this.process.once("error", (error) => {
        clearTimeout(timer);
        rejectReady(error);
      });
    });
  }

  async request(method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    await this.start();
    const id = this.nextId++;
    const requestValue = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(fail(`MCP server ${this.definition.id} timed out during ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      this.process.stdin.write(`${JSON.stringify(requestValue)}\n`, "utf8", (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        rejectRequest(error);
      });
    });
  }

  notify(method, params = {}) {
    if (!this.process || this.process.killed) return;
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async initialize() {
    if (this.initialized) return;
    const result = await this.request("initialize", {
      protocolVersion: DEFAULT_PROTOCOL,
      capabilities: {},
      clientInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
    if (!result || typeof result !== "object") throw fail(`MCP server ${this.definition.id} returned invalid initialization`);
    this.notify("notifications/initialized", {});
    this.initialized = true;
  }

  async refresh() {
    await this.initialize();
    const result = await this.request("tools/list", {});
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    this.tools = tools.filter(
      (tool) => tool && typeof tool === "object" && typeof tool.name === "string" && tool.name,
    );
    this.error = null;
    return this.tools;
  }

  async call(toolName, argumentsValue) {
    await this.initialize();
    return this.request("tools/call", { name: toolName, arguments: argumentsValue }, 120_000);
  }

  close() {
    try {
      this.reader?.close();
    } catch {}
    try {
      this.process?.kill();
    } catch {}
  }
}

class CapabilitySurface {
  constructor(config) {
    this.config = config;
    this.children = new Map();
    this.capabilities = new Map();
    this.directTools = new Map();
    this.lastRefreshAt = null;
    this.lastRefreshDigest = null;
    for (const definition of config.servers || []) {
      if (!definition?.id || this.children.has(definition.id)) throw fail("Capability server IDs must be unique");
      this.children.set(definition.id, new ChildMcp(definition, config));
    }
  }

  limits() {
    const catalog = this.config.catalog || {};
    return {
      maximumBytes: Number(catalog.maximumPayloadBytes || 131072),
      maximumDepth: Number(catalog.maximumJsonDepth || 18),
      maximumCapabilities: Number(catalog.maximumCapabilities || 1024),
      maximumDirectTools: Number(catalog.maximumDirectTools || 192),
    };
  }

  isReadOnly(tool) {
    if (tool?.annotations?.readOnlyHint === true) return true;
    if (tool?.annotations?.destructiveHint === true) return false;
    return /(^|_)(get|list|read|find|search|inspect|diagnose|status|capabilit|describe|plan|preview|observe)(_|$)/i.test(
      String(tool?.name || ""),
    );
  }

  addCapability(serverDefinition, tool, available = true, availabilityError = null) {
    const id = `${serverDefinition.id}/${tool.name}`;
    if (this.capabilities.has(id)) throw fail(`Duplicate capability ID ${id}`);
    const readOnly = this.isReadOnly(tool);
    const directName = `evavo__${safeName(serverDefinition.id)}__${safeName(tool.name)}`.slice(0, 128);
    const capability = {
      id,
      serverId: serverDefinition.id,
      serverTitle: serverDefinition.title || serverDefinition.id,
      authority: serverDefinition.authority || null,
      toolName: tool.name,
      directName,
      title: tool.title || tool.name,
      description: tool.description || "",
      inputSchema: tool.inputSchema || { type: "object", additionalProperties: true },
      outputSchema: tool.outputSchema || null,
      annotations: tool.annotations || {},
      readOnly,
      effect: readOnly ? "read" : "effect",
      available,
      availabilityError,
      directExpose: serverDefinition.directExpose === true,
    };
    this.capabilities.set(id, capability);
    return capability;
  }

  loadExternalCatalog() {
    const envName = String(this.config.catalog?.dynamicCatalogEnvironment || "EVAVO_CHATGPT_CAPABILITY_CATALOG");
    const selected = process.env[envName];
    if (!selected) return [];
    const full = regularFile(selected, "Dynamic EVAVO capability catalog");
    const value = loadJson(full, "Dynamic EVAVO capability catalog");
    const rows = Array.isArray(value.capabilities) ? value.capabilities : [];
    return rows.filter((row) => row && typeof row === "object" && typeof row.id === "string");
  }

  async refresh(force = false) {
    const refreshSeconds = Number(this.config.catalog?.refreshSeconds || 30);
    if (
      !force &&
      this.lastRefreshAt &&
      Date.now() - this.lastRefreshAt < refreshSeconds * 1000 &&
      this.capabilities.size
    ) {
      return this.summary();
    }
    this.capabilities.clear();
    this.directTools.clear();
    const failures = [];
    for (const [serverId, child] of this.children) {
      const definition = child.definition;
      try {
        const tools = await child.refresh();
        for (const tool of tools) this.addCapability(definition, tool, true, null);
      } catch (error) {
        failures.push({ serverId, error: String(error?.message || error).slice(0, 500) });
      }
    }
    for (const row of this.loadExternalCatalog()) {
      if (this.capabilities.has(row.id)) continue;
      const [serverId, ...toolParts] = String(row.id).split("/");
      const serverDefinition = this.children.get(serverId)?.definition || {
        id: serverId || "catalog",
        title: row.serverTitle || serverId || "Catalog",
        authority: row.authority || null,
        directExpose: false,
      };
      this.addCapability(
        serverDefinition,
        {
          name: row.toolName || toolParts.join("/") || row.id,
          title: row.title,
          description: row.description,
          inputSchema: row.inputSchema,
          outputSchema: row.outputSchema,
          annotations: row.annotations,
        },
        row.available === true,
        row.availabilityError || "catalog-only",
      );
    }
    const { maximumCapabilities, maximumDirectTools } = this.limits();
    if (this.capabilities.size > maximumCapabilities) throw fail("Capability catalog exceeds its admitted maximum");
    const direct = [...this.capabilities.values()]
      .filter((capability) => capability.directExpose && capability.available)
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, maximumDirectTools);
    for (const capability of direct) this.directTools.set(capability.directName, capability.id);
    this.lastRefreshAt = Date.now();
    this.lastRefreshDigest = createHash("sha256")
      .update(JSON.stringify([...this.capabilities.keys()].sort()))
      .digest("hex");
    return this.summary(failures);
  }

  summary(failures = []) {
    return {
      schemaVersion: 1,
      kind: "evavo-chatgpt-capability-catalog-status-v1",
      ok: [...this.children.values()].every((child) => child.definition.required !== true || !child.error),
      serverId: this.config.server?.id || SERVER_NAME,
      capabilityCount: this.capabilities.size,
      directToolCount: this.directTools.size,
      catalogDigestSha256: this.lastRefreshDigest,
      refreshedAt: this.lastRefreshAt ? new Date(this.lastRefreshAt).toISOString() : null,
      failures,
      stableRouterAvailable: true,
      githubRelayFallbackPrepared: true,
      arbitraryShellAccepted: false,
      callerSelectedExecutableAccepted: false,
      automaticReplayOfUncertainEffect: false,
      credentialValuesReturned: false,
    };
  }

  list(filter = {}) {
    const query = String(filter.query || "").trim().toLowerCase();
    const serverId = String(filter.serverId || "").trim();
    const effect = String(filter.effect || "").trim();
    const available = filter.available;
    const limit = Math.max(1, Math.min(Number(filter.limit || 200), 1000));
    return [...this.capabilities.values()]
      .filter((capability) => !serverId || capability.serverId === serverId)
      .filter((capability) => !effect || capability.effect === effect)
      .filter((capability) => typeof available !== "boolean" || capability.available === available)
      .filter((capability) => {
        if (!query) return true;
        return `${capability.id} ${capability.title} ${capability.description}`.toLowerCase().includes(query);
      })
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((capability) => ({
        id: capability.id,
        title: capability.title,
        description: capability.description,
        serverId: capability.serverId,
        authority: capability.authority,
        effect: capability.effect,
        readOnly: capability.readOnly,
        available: capability.available,
        directToolName: this.directTools.has(capability.directName) ? capability.directName : null,
      }));
  }

  describe(id) {
    const capability = this.capabilities.get(String(id));
    if (!capability) throw fail("Unknown capability ID", -32602);
    return { ...capability };
  }

  async invoke(id, argumentsValue, mode, intent) {
    const capability = this.capabilities.get(String(id));
    if (!capability) throw fail("Unknown capability ID", -32602);
    if (!capability.available) throw fail("Capability is currently unavailable", -32004, { capabilityId: id });
    if (!capability.readOnly) {
      if (mode !== "reviewed") throw fail("Effectful capability requires reviewed mode", -32602);
      if (typeof intent !== "string" || intent.trim().length < 8 || intent.length > 2000) {
        throw fail("Effectful capability requires bounded explicit user intent", -32602);
      }
    }
    const args = boundedJson(argumentsValue || {}, this.limits().maximumBytes, this.limits().maximumDepth);
    const child = this.children.get(capability.serverId);
    if (!child) throw fail("Capability has no live admitted MCP transport", -32004);
    const result = await child.call(capability.toolName, args);
    return {
      schemaVersion: 1,
      kind: "evavo-chatgpt-capability-invocation-v1",
      ok: result?.isError !== true,
      capabilityId: capability.id,
      effect: capability.effect,
      reviewedMode: mode === "reviewed",
      explicitIntentPresent: capability.readOnly ? null : true,
      result: redactSecrets(result),
      authoritativeExecutionReceiptRequired: !capability.readOnly,
      automaticReplayOfUncertainEffect: false,
      credentialValuesReturned: false,
    };
  }

  directToolDefinitions() {
    return [...this.directTools.entries()].map(([name, id]) => {
      const capability = this.capabilities.get(id);
      return {
        name,
        title: capability.title,
        description: `${capability.description}\n\nEVAVO capability ID: ${capability.id}`.trim(),
        inputSchema: capability.inputSchema,
        ...(capability.outputSchema ? { outputSchema: capability.outputSchema } : {}),
        annotations: {
          ...capability.annotations,
          readOnlyHint: capability.readOnly,
        },
      };
    });
  }

  close() {
    for (const child of this.children.values()) child.close();
  }
}

const config = loadJson(CONFIG_PATH, "EVAVO ChatGPT capability surface contract");
if (
  config.schemaVersion !== 1 ||
  config.kind !== "evavo-chatgpt-unified-capability-surface-v1" ||
  config.status !== "canonical"
) {
  throw fail("EVAVO ChatGPT capability surface contract identity drifted");
}
const surface = new CapabilitySurface(config);

const META_TOOLS = [
  {
    name: "evavo_capabilities",
    title: "EVAVO capabilities",
    description: "List every admitted EVAVO capability currently known to the stable ChatGPT surface. Call this before claiming a capability is unavailable.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", maxLength: 300 },
        serverId: { type: "string", maxLength: 128 },
        effect: { type: "string", enum: ["read", "effect"] },
        available: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 1000 },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "evavo_capability_describe",
    title: "Describe EVAVO capability",
    description: "Return the exact schema, authority, availability and effect classification for one admitted capability ID.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["capabilityId"],
      properties: { capabilityId: { type: "string", minLength: 3, maxLength: 300 } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "evavo_capability_refresh",
    title: "Refresh EVAVO capabilities",
    description: "Refresh child MCP tool catalogs without changing ChatGPT's stable router tool names.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "evavo_capability_invoke",
    title: "Invoke EVAVO capability",
    description: "Invoke an admitted typed capability by ID. It never accepts raw shell, caller-selected executables or caller-supplied script source. Effectful capabilities require reviewed mode and explicit user intent.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["capabilityId", "arguments", "mode"],
      properties: {
        capabilityId: { type: "string", minLength: 3, maxLength: 300 },
        arguments: { type: "object" },
        mode: { type: "string", enum: ["inspect", "reviewed"] },
        intent: { type: "string", maxLength: 2000 },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "evavo_surface_status",
    title: "EVAVO surface status",
    description: "Report native catalog status, child MCP availability and the governed GitHub relay fallback without returning credentials.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "evavo_relay_prepare",
    title: "Prepare EVAVO relay request",
    description: "Prepare, but do not submit, a structured reviewed GitHub relay request for an admitted capability. This is the fallback when the native child transport is unavailable.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["capabilityId", "arguments", "intent"],
      properties: {
        capabilityId: { type: "string", minLength: 3, maxLength: 300 },
        arguments: { type: "object" },
        intent: { type: "string", minLength: 8, maxLength: 2000 },
        requestId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{7,119}$" },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "evavo_fleet_capabilities",
    title: "EVAVO fleet capabilities compatibility alias",
    description: "Compatibility alias for evavo_capabilities.",
    inputSchema: { type: "object", additionalProperties: false, properties: { query: { type: "string", maxLength: 300 }, limit: { type: "integer", minimum: 1, maximum: 1000 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "fleet_capabilities",
    title: "Fleet capabilities compatibility alias",
    description: "Compatibility alias for evavo_capabilities.",
    inputSchema: { type: "object", additionalProperties: false, properties: { query: { type: "string", maxLength: 300 }, limit: { type: "integer", minimum: 1, maximum: 1000 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

async function handleTool(name, args) {
  const limits = surface.limits();
  boundedJson(args || {}, limits.maximumBytes, limits.maximumDepth);
  if (name === "evavo_capabilities" || name === "evavo_fleet_capabilities" || name === "fleet_capabilities") {
    await surface.refresh(false);
    return content({
      schemaVersion: 1,
      kind: "evavo-chatgpt-capability-catalog-v1",
      ...surface.summary(),
      capabilities: surface.list(args || {}),
      allCapabilitiesDiscoverableThroughStableRouter: true,
      newCapabilityRequiresNewChatTool: false,
    });
  }
  if (name === "evavo_capability_describe") {
    await surface.refresh(false);
    return content({ schemaVersion: 1, kind: "evavo-chatgpt-capability-description-v1", ok: true, capability: surface.describe(args.capabilityId) });
  }
  if (name === "evavo_capability_refresh") {
    return content(await surface.refresh(true));
  }
  if (name === "evavo_capability_invoke") {
    await surface.refresh(false);
    return content(await surface.invoke(args.capabilityId, args.arguments, args.mode, args.intent));
  }
  if (name === "evavo_surface_status") {
    await surface.refresh(false);
    return content({
      ...surface.summary(),
      nativeNamespace: SERVER_NAME,
      stableTools: config.stableTools,
      compatibilityAliases: config.server?.compatibilityAliases || [],
      existingAttachedChatsUseStableRouter: true,
      unattachedChatsRequireWorkspaceAppOrGithubFallback: true,
      githubRelayFallback: config.relay,
    });
  }
  if (name === "evavo_relay_prepare") {
    await surface.refresh(false);
    const capability = surface.describe(args.capabilityId);
    const requestId = args.requestId || `chatgpt-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 12)}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,119}$/.test(requestId)) throw fail("Relay request ID is invalid", -32602);
    boundedJson(args.arguments || {}, limits.maximumBytes, limits.maximumDepth);
    const job = {
      schema: "evavo.chatgpt-workstation-job.v1",
      id: requestId,
      mode: "reviewed",
      task: "evavo-capability-dispatch-v1",
      capabilityId: capability.id,
      arguments: args.arguments || {},
      intent: args.intent,
    };
    return content({
      schemaVersion: 1,
      kind: "evavo-chatgpt-relay-request-preparation-v1",
      ok: true,
      prepareOnly: true,
      repository: config.relay.repository,
      title: `EVAVO workstation capability ${requestId}`,
      body: `<!-- ${config.relay.jobMarker} -->\n\n\`\`\`json\n${JSON.stringify(job, null, 2)}\n\`\`\`\n`,
      capabilityId: capability.id,
      submissionRequiresConnectedGitHubOrGovernedRelay: true,
      executionNotClaimed: true,
      credentialValuesReturned: false,
    });
  }
  const capabilityId = surface.directTools.get(name);
  if (capabilityId) {
    const capability = surface.describe(capabilityId);
    return content(await surface.invoke(capabilityId, args || {}, capability.readOnly ? "inspect" : "reviewed", capability.readOnly ? undefined : `Direct invocation of ${capabilityId}`));
  }
  throw fail("Unknown tool", -32601);
}

async function handle(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) throw fail("Invalid JSON-RPC request", -32600);
  const method = String(message.method || "");
  if (!method) throw fail("JSON-RPC method is required", -32600);
  if (method === "notifications/initialized" || method === "notifications/cancelled") return null;
  if (method === "initialize") {
    const requested = String(message.params?.protocolVersion || DEFAULT_PROTOCOL);
    const allowed = new Set(config.server?.protocolVersions || [DEFAULT_PROTOCOL]);
    return response(message.id, {
      protocolVersion: allowed.has(requested) ? requested : DEFAULT_PROTOCOL,
      capabilities: { tools: { listChanged: true }, resources: { subscribe: false, listChanged: true } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: config.server?.instructions,
    });
  }
  if (method === "server/discover") {
    return response(message.id, {
      supportedVersions: config.server?.protocolVersions || [DEFAULT_PROTOCOL],
      capabilities: { tools: { listChanged: true }, resources: { listChanged: true } },
      instructions: config.server?.instructions,
      _meta: { "io.modelcontextprotocol/serverInfo": { name: SERVER_NAME, version: SERVER_VERSION } },
    });
  }
  if (method === "ping") return response(message.id, {});
  if (method === "tools/list") {
    await surface.refresh(false);
    return response(message.id, { tools: [...META_TOOLS, ...surface.directToolDefinitions()] });
  }
  if (method === "tools/call") {
    const params = assertObject(message.params || {}, "tools/call params");
    const name = String(params.name || "");
    const args = params.arguments === undefined ? {} : assertObject(params.arguments, "tool arguments");
    try {
      return response(message.id, await handleTool(name, args));
    } catch (error) {
      return response(message.id, content({ ok: false, kind: "evavo-chatgpt-tool-error-v1", error: String(error?.message || error).slice(0, 2000), code: error?.rpcCode || -32603, credentialValuesReturned: false }, true));
    }
  }
  if (method === "resources/list") {
    return response(message.id, {
      resources: [
        {
          uri: "evavo://capabilities",
          name: "EVAVO capability catalog",
          description: "Live admitted capability catalog behind the stable ChatGPT router.",
          mimeType: "application/json",
        },
        {
          uri: "evavo://surface-status",
          name: "EVAVO ChatGPT surface status",
          description: "Native and fallback surface readiness without credential values.",
          mimeType: "application/json",
        },
      ],
    });
  }
  if (method === "resources/read") {
    const uri = String(message.params?.uri || "");
    await surface.refresh(false);
    let payload;
    if (uri === "evavo://capabilities") payload = { ...surface.summary(), capabilities: surface.list({ limit: 1000 }) };
    else if (uri === "evavo://surface-status") payload = surface.summary();
    else throw fail("Unknown resource", -32602);
    return response(message.id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(redactSecrets(payload)) }] });
  }
  if (method === "logging/setLevel") return response(message.id, {});
  throw fail("Method not found", -32601);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(`${JSON.stringify(errorResponse(null, fail("Parse error", -32700)))}\n`);
    return;
  }
  try {
    const result = await handle(message);
    if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (Object.prototype.hasOwnProperty.call(message || {}, "id")) {
      process.stdout.write(`${JSON.stringify(errorResponse(message.id, error))}\n`);
    }
  }
});

function shutdown() {
  surface.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => surface.close());
