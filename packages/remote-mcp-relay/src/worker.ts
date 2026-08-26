import { DurableObject } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

interface Env {
  WORKSTATION_RELAY: DurableObjectNamespace<WorkstationRelay>;
  WORKSTATION_TOKEN: string;
  DISPATCH_TOKEN: string;
}

type Presence = {
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

type DispatchMessage = {
  id: string;
  type: "dispatch";
  action: string;
  arguments: Record<string, unknown>;
  requestedAt: string;
  deadline: string;
};

type ResultMessage = {
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

type Pending = {
  resolve: (value: ResultMessage) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const OBJECT_NAME = "primary-workstation";
const MAX_DISPATCH_BYTES = 32 * 1024;
const MAX_RESULT_BYTES = 128 * 1024;
const MAX_SYNC_WAIT_MS = 60_000;
const MAX_DEADLINE_MS = 10 * 60_000;
const MAX_STORED_REQUESTS = 256;
const STORAGE_ACTIONS = new Set([
  "storage.status",
  "storage.inventory.refresh",
  "storage.google_pressure.activate",
  "storage.estate.activate",
]);
const ACTIONS = new Set([
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

function bearer(request: Request): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function stub(env: Env): DurableObjectStub<WorkstationRelay> {
  return env.WORKSTATION_RELAY.get(env.WORKSTATION_RELAY.idFromName(OBJECT_NAME));
}

async function internalStatus(env: Env): Promise<Record<string, unknown>> {
  const response = await stub(env).fetch("https://relay.internal/status");
  if (!response.ok) throw new Error(`relay-status-${response.status}`);
  return (await response.json()) as Record<string, unknown>;
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
    rawShellExposed: false,
  };
}

async function internalRequestStatus(env: Env, requestId: string): Promise<Record<string, unknown>> {
  const url = new URL("https://relay.internal/request");
  url.searchParams.set("id", requestId);
  const response = await stub(env).fetch(url);
  const value = (await response.json()) as Record<string, unknown>;
  if (!response.ok && response.status !== 404) throw new Error(`relay-request-${response.status}`);
  return value;
}

function makeMcpServer(env: Env): McpServer {
  const server = new McpServer({ name: "EVAVO Workstation Relay", version: "0.3.0" });
  server.registerTool(
    "workstation_status",
    {
      description: "Read coarse EVAVO Windows workstation relay status. This never dispatches work.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => ({ content: [{ type: "text", text: JSON.stringify(publicStatus(await internalStatus(env))) }] }),
  );
  server.registerTool(
    "workstation_capabilities",
    {
      description: "Read the bounded capabilities currently advertised by the workstation relay. This never dispatches work.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const status = publicStatus(await internalStatus(env));
      return { content: [{ type: "text", text: JSON.stringify({ online: status.online, capabilities: status.capabilities, workerFabricProfile: status.workerFabricProfile, dispatchRequiresSeparateAuthenticatedApi: true, rawShellExposed: false }) }] };
    },
  );
  server.registerTool(
    "workstation_request_status",
    {
      description: "Read a previously dispatched workstation request by opaque UUID. This never dispatches work.",
      inputSchema: { requestId: z.string().uuid() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ requestId }) => ({ content: [{ type: "text", text: JSON.stringify(await internalRequestStatus(env, requestId)) }] }),
  );
  return server;
}

export class WorkstationRelay extends DurableObject<Env> {
  private readonly pending = new Map<string, Pending>();

  private sockets(): WebSocket[] {
    return this.ctx.getWebSockets("workstation").filter((socket) => socket.readyState === WebSocket.OPEN);
  }

  private requestKey(id: string): string { return `request:${id}`; }

  private async presence(): Promise<Presence | null> {
    return (await this.ctx.storage.get<Presence>("presence")) ?? null;
  }

  private async status(): Promise<Record<string, unknown>> {
    const presence = await this.presence();
    let ageSeconds: number | null = null;
    if (presence?.lastSeen) {
      const time = Date.parse(presence.lastSeen);
      if (Number.isFinite(time)) ageSeconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
    }
    return {
      online: this.sockets().length > 0,
      lastSeen: presence?.lastSeen ?? null,
      ageSeconds,
      clientVersion: presence?.clientVersion ?? null,
      runtimeRevision: presence?.runtimeRevision ?? null,
      workerFabricProfile: presence?.workerFabricProfile ?? null,
      capabilities: presence?.capabilities ?? [],
      lastReceiptKind: presence?.lastReceiptKind ?? null,
      lastReceiptAt: presence?.lastReceiptAt ?? null,
    };
  }

  private async updatePresence(message: Record<string, unknown>): Promise<void> {
    const old = await this.presence();
    const now = new Date().toISOString();
    const capabilities = Array.isArray(message.capabilities)
      ? message.capabilities.filter((value): value is string => typeof value === "string").slice(0, 64)
      : old?.capabilities ?? [];
    await this.ctx.storage.put("presence", {
      nodeId: typeof message.nodeId === "string" ? message.nodeId.slice(0, 128) : old?.nodeId ?? "windows-workstation",
      clientVersion: typeof message.clientVersion === "string" ? message.clientVersion.slice(0, 64) : old?.clientVersion ?? "unknown",
      runtimeRevision: typeof message.runtimeRevision === "string" ? message.runtimeRevision.slice(0, 64) : old?.runtimeRevision ?? null,
      workerFabricProfile: typeof message.workerFabricProfile === "string" ? message.workerFabricProfile.slice(0, 64) : old?.workerFabricProfile ?? null,
      capabilities,
      lastSeen: now,
      connectedAt: old?.connectedAt ?? now,
      lastReceiptKind: old?.lastReceiptKind ?? null,
      lastReceiptAt: old?.lastReceiptAt ?? null,
    } satisfies Presence);
  }

  private async remember(record: DispatchRecord): Promise<void> {
    await this.ctx.storage.put(this.requestKey(record.id), record);
    const previous = (await this.ctx.storage.get<string[]>("request-index")) ?? [];
    const ids = [...previous.filter((id) => id !== record.id), record.id];
    const expired = ids.length > MAX_STORED_REQUESTS ? ids.splice(0, ids.length - MAX_STORED_REQUESTS) : [];
    if (expired.length) await Promise.all(expired.map((id) => this.ctx.storage.delete(this.requestKey(id))));
    await this.ctx.storage.put("request-index", ids);
  }

  private async finish(message: ResultMessage): Promise<void> {
    const oldPresence = await this.presence();
    if (oldPresence) {
      await this.ctx.storage.put("presence", { ...oldPresence, lastSeen: new Date().toISOString(), lastReceiptKind: message.action.slice(0, 128), lastReceiptAt: message.completedAt } satisfies Presence);
    }
    const existing = await this.ctx.storage.get<DispatchRecord>(this.requestKey(message.id));
    if (!existing || existing.action !== message.action) return;
    await this.remember({
      ...existing,
      status: message.ok ? "completed" : "failed",
      completedAt: message.completedAt,
      ok: message.ok,
      ...(message.result === undefined ? {} : { result: message.result }),
      ...(message.error === undefined ? {} : { error: message.error.slice(0, 1024) }),
    });
  }

  private async requestStatus(id: string): Promise<Response> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, error: "invalid-request-id" }, { status: 400 });
    const record = await this.ctx.storage.get<DispatchRecord>(this.requestKey(id));
    if (!record) return json({ ok: false, error: "request-not-found", requestId: id }, { status: 404 });
    return json({ ok: true, request: record });
  }

  private async dispatch(body: Record<string, unknown>): Promise<Response> {
    const sockets = this.sockets();
    if (sockets.length !== 1) return json({ ok: false, error: sockets.length ? "multiple-workstations-connected" : "workstation-offline" }, { status: 503 });
    const action = typeof body.action === "string" ? body.action : "";
    if (!ACTIONS.has(action)) return json({ ok: false, error: "action-not-admitted" }, { status: 400 });
    const args = body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments) ? body.arguments as Record<string, unknown> : {};
    if (STORAGE_ACTIONS.has(action) && Object.keys(args).length !== 0) return json({ ok: false, error: "storage-actions-require-empty-arguments" }, { status: 400 });
    if (new TextEncoder().encode(JSON.stringify(args)).byteLength > MAX_DISPATCH_BYTES) return json({ ok: false, error: "arguments-too-large" }, { status: 413 });

    const requestedAt = new Date();
    const desired = Number(body.timeoutMs ?? (STORAGE_ACTIONS.has(action) ? MAX_DEADLINE_MS : 30_000));
    const deadlineMs = Math.min(MAX_DEADLINE_MS, Math.max(1_000, Number.isFinite(desired) ? desired : 30_000));
    const id = crypto.randomUUID();
    const deadline = new Date(requestedAt.getTime() + deadlineMs).toISOString();
    const message: DispatchMessage = { id, type: "dispatch", action, arguments: args, requestedAt: requestedAt.toISOString(), deadline };
    await this.remember({ id, action, status: "queued", requestedAt: message.requestedAt, deadline, completedAt: null, ok: null });
    sockets[0].send(JSON.stringify(message));

    const wait = typeof body.wait === "boolean" ? body.wait : !STORAGE_ACTIONS.has(action);
    if (!wait) return json({ ok: true, id, action, status: "queued", deadline }, { status: 202 });
    const waitMs = Math.min(MAX_SYNC_WAIT_MS, deadlineMs);
    const resultPromise = new Promise<ResultMessage>((resolve, reject) => {
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
    if (url.pathname === "/dispatch" && request.method === "POST") return this.dispatch(await request.json() as Record<string, unknown>);
    if (url.pathname === "/connect") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
      for (const old of this.ctx.getWebSockets("workstation")) { try { old.close(4001, "superseded"); } catch { /* ignore */ } }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, ["workstation"]);
      server.serializeAttachment({ connectedAt: new Date().toISOString() });
      await this.updatePresence({ type: "connected" });
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("Not Found", { status: 404 });
  }

  webSocketMessage(_socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string" || new TextEncoder().encode(message).byteLength > MAX_RESULT_BYTES) return;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(message) as Record<string, unknown>; } catch { return; }
    if (parsed.type === "hello" || parsed.type === "heartbeat") { this.ctx.waitUntil(this.updatePresence(parsed)); return; }
    if (parsed.type !== "result" || typeof parsed.id !== "string" || typeof parsed.action !== "string" || typeof parsed.ok !== "boolean" || typeof parsed.completedAt !== "string") return;
    const result = parsed as unknown as ResultMessage;
    this.ctx.waitUntil(this.finish(result));
    const pending = this.pending.get(result.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(result.id);
    pending.resolve(result);
  }

  webSocketClose(socket: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    try { socket.close(code, reason); } catch { /* ignore */ }
    for (const [id, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(new Error("workstation-disconnected")); this.pending.delete(id); }
  }

  webSocketError(_socket: WebSocket, _error: unknown): void {
    for (const [id, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(new Error("workstation-websocket-error")); this.pending.delete(id); }
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const relay = stub(env);
    if (url.pathname === "/connect") {
      const supplied = bearer(request);
      if (!supplied || !constantTimeEqual(supplied, env.WORKSTATION_TOKEN)) return json({ ok: false, error: "unauthorized" }, { status: 401 });
      return relay.fetch(new Request("https://relay.internal/connect", { method: "GET", headers: request.headers }));
    }
    if (url.pathname === "/api/dispatch") {
      const supplied = bearer(request);
      if (!supplied || !constantTimeEqual(supplied, env.DISPATCH_TOKEN)) return json({ ok: false, error: "unauthorized" }, { status: 401 });
      if (request.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, { status: 405 });
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_DISPATCH_BYTES) return json({ ok: false, error: "body-too-large" }, { status: 413 });
      return relay.fetch(new Request("https://relay.internal/dispatch", { method: "POST", headers: { "content-type": "application/json" }, body }));
    }
    if (url.pathname === "/api/request" && request.method === "GET") {
      const supplied = bearer(request);
      if (!supplied || !constantTimeEqual(supplied, env.DISPATCH_TOKEN)) return json({ ok: false, error: "unauthorized" }, { status: 401 });
      const internal = new URL("https://relay.internal/request");
      internal.searchParams.set("id", url.searchParams.get("id") ?? "");
      return relay.fetch(internal);
    }
    if (url.pathname === "/api/status" && request.method === "GET") return json(publicStatus(await internalStatus(env)));
    if (url.pathname === "/health" && request.method === "GET") {
      const status = publicStatus(await internalStatus(env));
      return json({ ok: true, service: "evavo-workstation-mcp-relay", workstationOnline: status.online });
    }
    if (url.pathname === "/mcp") return createMcpHandler(() => makeMcpServer(env), { route: "/mcp", responseMode: "json", legacy: "stateless" })(request, env, ctx);
    return new Response("EVAVO workstation MCP relay", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
