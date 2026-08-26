import { DurableObject } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

interface Env {
  WORKSTATION_RELAY: DurableObjectNamespace<WorkstationRelay>;
  WORKSTATION_TOKEN: string;
  DISPATCH_TOKEN: string;
}

type RelayPresence = {
  nodeId: string;
  clientVersion: string;
  runtimeRevision: string | null;
  workerFabricProfile: string | null;
  capabilities: string[];
  lastSeen: string;
  connectedAt: string;
  lastReceiptKind: string | null;
  lastReceiptAt: string | null;
};

type DispatchRequest = {
  id: string;
  type: "dispatch";
  action: string;
  arguments: Record<string, unknown>;
  requestedAt: string;
  deadline: string;
};

type DispatchResult = {
  id: string;
  type: "result";
  ok: boolean;
  action: string;
  completedAt: string;
  result?: unknown;
  error?: string;
};

type DispatchRecord = {
  id: string;
  action: string;
  status: "queued" | "completed" | "failed";
  requestedAt: string;
  deadline: string;
  completedAt: string | null;
  ok: boolean | null;
  result?: unknown;
  error?: string;
};

type PendingDispatch = {
  resolve: (value: DispatchResult) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const RELAY_OBJECT_NAME = "primary-workstation";
const MAX_DISPATCH_BYTES = 32 * 1024;
const MAX_RESULT_BYTES = 128 * 1024;
const MAX_SYNC_WAIT_MS = 60_000;
const MAX_DEADLINE_MS = 10 * 60_000;
const REQUEST_RETENTION_SECONDS = 24 * 60 * 60;

const STORAGE_ACTIONS = new Set([
  "storage.status",
  "storage.inventory.refresh",
  "storage.google_pressure.activate",
  "storage.estate.activate",
]);

const ALLOWED_DISPATCH_ACTIONS = new Set([
  "workstation.status",
  "workstation.repair",
  "workstation.bootstrap",
  "rest.health",
  "execution.prepare",
  "execution.run_request",
  "godot.runtime_probe",
  ...STORAGE_ACTIONS,
]);

function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

function constantTimeEqual(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

function relayStub(env: Env): DurableObjectStub<WorkstationRelay> {
  return env.WORKSTATION_RELAY.get(env.WORKSTATION_RELAY.idFromName(RELAY_OBJECT_NAME));
}

async function relayStatus(env: Env): Promise<Record<string, unknown>> {
  const response = await relayStub(env).fetch("https://relay.internal/status");
  if (!response.ok) throw new Error(`relay-status-${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

async function relayRequestStatus(env: Env, requestId: string): Promise<Record<string, unknown>> {
  const url = new URL("https://relay.internal/request");
  url.searchParams.set("id", requestId);
  const response = await relayStub(env).fetch(url);
  const value = (await response.json()) as Record<string, unknown>;
  if (!response.ok && response.status !== 404) throw new Error(`relay-request-${response.status}`);
  return value;
}

function publicStatus(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    online: raw.online === true,
    lastSeen: raw.lastSeen ?? null,
    ageSeconds: raw.ageSeconds ?? null,
    clientVersion: raw.clientVersion ?? null,
    runtimeRevision: raw.runtimeRevision ?? null,
    workerFabricProfile: raw.workerFabricProfile ?? null,
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities : [],
    lastReceiptKind: raw.lastReceiptKind ?? null,
    lastReceiptAt: raw.lastReceiptAt ?? null,
    transport: "outbound-websocket-via-cloudflare-durable-object",
    dispatchExposedThroughProMcp: false,
  };
}

function createServer(env: Env): McpServer {
  const server = new McpServer({ name: "EVAVO Workstation Relay", version: "0.2.0" });

  server.registerTool(
    "workstation_status",
    {
      description: "Read the current coarse EVAVO Windows workstation relay status. This tool never dispatches work.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => ({ content: [{ type: "text", text: JSON.stringify(publicStatus(await relayStatus(env))) }] }),
  );

  server.registerTool(
    "workstation_capabilities",
    {
      description: "Read the currently advertised bounded workstation relay capabilities. This tool never dispatches work.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const status = publicStatus(await relayStatus(env));
      return { content: [{ type: "text", text: JSON.stringify({ online: status.online, capabilities: status.capabilities, workerFabricProfile: status.workerFabricProfile, dispatchRequiresSeparateAuthenticatedApi: true, rawShellExposed: false }) }] };
    },
  );

  server.registerTool(
    "workstation_request_status",
    {
      description: "Read a previously dispatched workstation request by its opaque UUID. This tool never dispatches work.",
      inputSchema: z.object({ requestId: z.string().uuid() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ requestId }) => ({ content: [{ type: "text", text: JSON.stringify(await relayRequestStatus(env, requestId)) }] }),
  );

  return server;
}

export class WorkstationRelay extends DurableObject<Env> {
  private readonly pending = new Map<string, PendingDispatch>();

  private sockets(): WebSocket[] { return this.ctx.getWebSockets("workstation"); }
  private requestKey(id: string): string { return `request:${id}`; }

  private async readPresence(): Promise<RelayPresence | null> {
    return (await this.ctx.storage.get<RelayPresence>("presence")) ?? null;
  }

  private async status(): Promise<Record<string, unknown>> {
    const presence = await this.readPresence();
    const online = this.sockets().length > 0;
    let ageSeconds: number | null = null;
    if (presence?.lastSeen) {
      const timestamp = Date.parse(presence.lastSeen);
      if (Number.isFinite(timestamp)) ageSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    }
    return {
      online,
      lastSeen: presence?.lastSeen ?? null,
      ageSeconds,
      clientVersion: presence?.clientVersion ?? null,
      runtimeRevision: presence?.runtimeRevision ?? null,
      workerFabricProfile: presence?.workerFabricProfile ?? null,
      capabilities: presence?.capabilities ?? [],
      lastReceiptKind: presence?.lastReceiptKind ?? null,
      lastReceiptAt: presence?.lastReceiptAt ?? null,
      socketCount: this.sockets().length,
    };
  }

  private async persistPresence(message: Record<string, unknown>): Promise<void> {
    const previous = await this.readPresence();
    const now = new Date().toISOString();
    const capabilities = Array.isArray(message.capabilities)
      ? message.capabilities.filter((value): value is string => typeof value === "string").slice(0, 64)
      : previous?.capabilities ?? [];
    const next: RelayPresence = {
      nodeId: typeof message.nodeId === "string" ? message.nodeId.slice(0, 128) : previous?.nodeId ?? "windows-workstation",
      clientVersion: typeof message.clientVersion === "string" ? message.clientVersion.slice(0, 64) : previous?.clientVersion ?? "unknown",
      runtimeRevision: typeof message.runtimeRevision === "string" ? message.runtimeRevision.slice(0, 64) : previous?.runtimeRevision ?? null,
      workerFabricProfile: typeof message.workerFabricProfile === "string" ? message.workerFabricProfile.slice(0, 64) : previous?.workerFabricProfile ?? null,
      capabilities,
      lastSeen: now,
      connectedAt: previous?.connectedAt ?? now,
      lastReceiptKind: previous?.lastReceiptKind ?? null,
      lastReceiptAt: previous?.lastReceiptAt ?? null,
    };
    await this.ctx.storage.put("presence", next);
  }

  private async persistResult(message: DispatchResult): Promise<void> {
    const previous = await this.readPresence();
    if (previous) {
      await this.ctx.storage.put("presence", { ...previous, lastSeen: new Date().toISOString(), lastReceiptKind: message.action.slice(0, 128), lastReceiptAt: message.completedAt } satisfies RelayPresence);
    }
    const existing = await this.ctx.storage.get<DispatchRecord>(this.requestKey(message.id));
    if (!existing || existing.action !== message.action) return;
    const record: DispatchRecord = {
      ...existing,
      status: message.ok ? "completed" : "failed",
      completedAt: message.completedAt,
      ok: message.ok,
      ...(message.result === undefined ? {} : { result: message.result }),
      ...(message.error === undefined ? {} : { error: message.error.slice(0, 1024) }),
    };
    await this.ctx.storage.put(this.requestKey(message.id), record, { expirationTtl: REQUEST_RETENTION_SECONDS });
  }

  private async requestStatus(id: string): Promise<Response> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, error: "invalid-request-id" }, { status: 400 });
    const record = await this.ctx.storage.get<DispatchRecord>(this.requestKey(id));
    if (!record) return json({ ok: false, error: "request-not-found", requestId: id }, { status: 404 });
    return json({ ok: true, request: record });
  }

  private async dispatch(body: Record<string, unknown>): Promise<Response> {
    const sockets = this.sockets();
    if (sockets.length < 1) return json({ ok: false, error: "workstation-offline" }, { status: 503 });
    const action = typeof body.action === "string" ? body.action : "";
    if (!ALLOWED_DISPATCH_ACTIONS.has(action)) return json({ ok: false, error: "action-not-admitted" }, { status: 400 });

    const argumentsValue = body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)
      ? (body.arguments as Record<string, unknown>)
      : {};
    if (STORAGE_ACTIONS.has(action) && Object.keys(argumentsValue).length !== 0) {
      return json({ ok: false, error: "storage-actions-require-empty-arguments" }, { status: 400 });
    }
    if (new TextEncoder().encode(JSON.stringify(argumentsValue)).byteLength > MAX_DISPATCH_BYTES) {
      return json({ ok: false, error: "arguments-too-large" }, { status: 413 });
    }

    const requestedAt = new Date();
    const requestedTimeout = Number(body.timeoutMs ?? (STORAGE_ACTIONS.has(action) ? MAX_DEADLINE_MS : 30_000));
    const deadlineMs = Math.min(MAX_DEADLINE_MS, Math.max(1_000, Number.isFinite(requestedTimeout) ? requestedTimeout : 30_000));
    const id = crypto.randomUUID();
    const deadline = new Date(requestedAt.getTime() + deadlineMs).toISOString();
    const request: DispatchRequest = { id, type: "dispatch", action, arguments: argumentsValue, requestedAt: requestedAt.toISOString(), deadline };
    const record: DispatchRecord = { id, action, status: "queued", requestedAt: request.requestedAt, deadline, completedAt: null, ok: null };
    await this.ctx.storage.put(this.requestKey(id), record, { expirationTtl: REQUEST_RETENTION_SECONDS });
    sockets[0].send(JSON.stringify(request));

    const wait = typeof body.wait === "boolean" ? body.wait : !STORAGE_ACTIONS.has(action);
    if (!wait) return json({ ok: true, id, action, status: "queued", deadline }, { status: 202 });

    const waitMs = Math.min(MAX_SYNC_WAIT_MS, deadlineMs);
    const resultPromise = new Promise<DispatchResult>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("workstation-dispatch-timeout")); }, waitMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    try {
      const result = await resultPromise;
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_RESULT_BYTES) return json({ ok: false, error: "result-too-large", id }, { status: 502 });
      return json(result, { status: result.ok ? 200 : 502 });
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) { clearTimeout(pending.timer); this.pending.delete(id); }
      return json({ ok: true, id, action, status: "queued", pollingRequired: true, error: error instanceof Error ? error.message : "dispatch-wait-ended" }, { status: 202 });
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/status" && request.method === "GET") return json(await this.status());
    if (url.pathname === "/request" && request.method === "GET") return this.requestStatus(url.searchParams.get("id") ?? "");
    if (url.pathname === "/dispatch" && request.method === "POST") return this.dispatch((await request.json()) as Record<string, unknown>);
    if (url.pathname === "/connect") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server, ["workstation"]);
      await this.persistPresence({ type: "connected" });
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("Not Found", { status: 404 });
  }

  webSocketMessage(_socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string" || message.length > MAX_RESULT_BYTES) return;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(message) as Record<string, unknown>; } catch { return; }
    if (parsed.type === "hello" || parsed.type === "heartbeat") { this.ctx.waitUntil(this.persistPresence(parsed)); return; }
    if (parsed.type !== "result" || typeof parsed.id !== "string" || typeof parsed.action !== "string" || typeof parsed.ok !== "boolean" || typeof parsed.completedAt !== "string") return;
    const result = parsed as unknown as DispatchResult;
    this.ctx.waitUntil(this.persistResult(result));
    const pending = this.pending.get(result.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(result.id);
    pending.resolve(result);
  }

  webSocketClose(socket: WebSocket, code: number, reason: string, wasClean: boolean): void {
    try { socket.close(code, reason); } catch { /* already closed */ }
    if (!wasClean) for (const [id, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(new Error("workstation-disconnected")); this.pending.delete(id); }
  }

  webSocketError(_socket: WebSocket, _error: unknown): void {
    for (const [id, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(new Error("workstation-websocket-error")); this.pending.delete(id); }
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const stub = relayStub(env);

    if (url.pathname === "/connect") {
      const supplied = bearer(request);
      if (!supplied || !constantTimeEqual(supplied, env.WORKSTATION_TOKEN)) return json({ ok: false, error: "unauthorized" }, { status: 401 });
      return stub.fetch(new Request("https://relay.internal/connect", request));
    }

    if (url.pathname === "/api/dispatch") {
      const supplied = bearer(request);
      if (!supplied || !constantTimeEqual(supplied, env.DISPATCH_TOKEN)) return json({ ok: false, error: "unauthorized" }, { status: 401 });
      if (request.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, { status: 405 });
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_DISPATCH_BYTES) return json({ ok: false, error: "body-too-large" }, { status: 413 });
      return stub.fetch(new Request("https://relay.internal/dispatch", { method: "POST", headers: { "content-type": "application/json" }, body }));
    }

    if (url.pathname === "/api/request" && request.method === "GET") {
      const supplied = bearer(request);
      if (!supplied || !constantTimeEqual(supplied, env.DISPATCH_TOKEN)) return json({ ok: false, error: "unauthorized" }, { status: 401 });
      const internal = new URL("https://relay.internal/request");
      internal.searchParams.set("id", url.searchParams.get("id") ?? "");
      return stub.fetch(internal);
    }

    if (url.pathname === "/api/status" && request.method === "GET") return json(publicStatus(await relayStatus(env)));
    if (url.pathname === "/health" && request.method === "GET") {
      const status = publicStatus(await relayStatus(env));
      return json({ ok: true, service: "evavo-workstation-mcp-relay", workstationOnline: status.online });
    }
    if (url.pathname === "/mcp") return createMcpHandler(() => createServer(env), { route: "/mcp", responseMode: "json", legacy: "stateless" })(request, env, ctx);
    return new Response("EVAVO workstation MCP relay", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
