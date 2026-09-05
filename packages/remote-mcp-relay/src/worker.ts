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

type DispatchStatus = "queued" | "dispatching" | "sent" | "completed" | "failed" | "ambiguous";
type DeliveryState = "not_sent" | "send_attempted" | "sent";
type EffectState = "not_applicable" | "not_attempted" | "unknown" | "receipt_returned";

type DispatchRecord = {
  id: string;
  action: string;
  status: DispatchStatus;
  deliveryState: DeliveryState;
  connectionId: string | null;
  requestedAt: string;
  deadline: string;
  sentAt: string | null;
  completedAt: string | null;
  ok: boolean | null;
  executionAttempted: boolean | null;
  sideEffectMayHaveCommitted: boolean;
  effectState: EffectState;
  retrySafe: boolean;
  terminalReason: string | null;
  result?: unknown;
  error?: string;
};

type Pending = {
  resolve: (value: ResultMessage) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  socket: WebSocket;
  connectionId: string | null;
};

const OBJECT_NAME = "primary-workstation";
const MAX_DISPATCH_BYTES = 32 * 1024;
const MAX_RESULT_BYTES = 128 * 1024;
const MAX_SYNC_WAIT_MS = 60_000;
const MAX_DEADLINE_MS = 10 * 60_000;
const MAX_STORED_REQUESTS = 256;
const DELIVERY_JOURNAL_VERSION = 1;
const STORAGE_ACTIONS = new Set([
  "storage.status",
  "storage.inventory.refresh",
  "storage.google_pressure.activate",
  "storage.estate.activate",
]);
const GATEWAY_READ_ACTIONS = new Set([
  "gateway.fabric_status",
]);
const EFFECTFUL_ACTIONS = new Set([
  "workstation.repair",
  "workstation.bootstrap",
  "storage.inventory.refresh",
  "storage.google_pressure.activate",
  "storage.estate.activate",
]);
const ACTIONS = new Set([
  "workstation.status",
  "workstation.repair",
  "workstation.bootstrap",
  "rest.health",
  ...GATEWAY_READ_ACTIONS,
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
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

function isEffectful(action: string): boolean {
  return EFFECTFUL_ACTIONS.has(action);
}

function isTerminalStatus(status: DispatchStatus): boolean {
  return status === "completed" || status === "failed" || status === "ambiguous";
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
    deliveryJournalVersion: DELIVERY_JOURNAL_VERSION,
    automaticReplayOfUncertainEffect: false,
    dispatchExposedThroughProMcp: false,
    typedReadDispatchExposedThroughProMcp: true,
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

function publicRequestStatus(raw: Record<string, unknown>): Record<string, unknown> {
  const request = raw.request && typeof raw.request === "object" && !Array.isArray(raw.request)
    ? raw.request as Record<string, unknown>
    : null;
  if (!request) {
    return {
      ok: false,
      found: false,
      requestId: typeof raw.requestId === "string" ? raw.requestId : null,
      state: raw.error === "request-not-found" ? "not_found" : "unavailable",
      detailedResultExposedThroughMcp: false,
    };
  }
  return {
    ok: raw.ok === true,
    found: true,
    request: {
      id: request.id ?? null,
      action: request.action ?? null,
      status: request.status ?? null,
      deliveryState: request.deliveryState ?? null,
      requestedAt: request.requestedAt ?? null,
      sentAt: request.sentAt ?? null,
      deadline: request.deadline ?? null,
      completedAt: request.completedAt ?? null,
      succeeded: request.ok ?? null,
      executionAttempted: request.executionAttempted ?? null,
      sideEffectMayHaveCommitted: request.sideEffectMayHaveCommitted === true,
      retrySafe: request.retrySafe === true,
      effectState: request.effectState ?? null,
      terminalReason: request.terminalReason ?? null,
    },
    automaticReplayAllowed: false,
    detailedResultExposedThroughMcp: false,
  };
}

async function internalGatewayFabricStatus(env: Env): Promise<Record<string, unknown>> {
  const response = await stub(env).fetch(new Request("https://relay.internal/dispatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "gateway.fabric_status", arguments: {}, wait: true, timeoutMs: 30_000 }),
  }));
  const value = (await response.json()) as Record<string, unknown>;
  if (!response.ok || value.ok !== true || value.action !== "gateway.fabric_status") {
    throw new Error(typeof value.error === "string" ? value.error : `gateway-fabric-status-${response.status}`);
  }
  const result = value.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("gateway-fabric-status-result-invalid");
  return result as Record<string, unknown>;
}

function publicGatewayFabricStatus(raw: Record<string, unknown>): Record<string, unknown> {
  const hardware = raw.hardware && typeof raw.hardware === "object" && !Array.isArray(raw.hardware)
    ? raw.hardware as Record<string, unknown>
    : {};
  const acceptance = raw.acceptance && typeof raw.acceptance === "object" && !Array.isArray(raw.acceptance)
    ? raw.acceptance as Record<string, unknown>
    : {};
  const snapshot = raw.snapshot && typeof raw.snapshot === "object" && !Array.isArray(raw.snapshot)
    ? raw.snapshot as Record<string, unknown>
    : {};
  return {
    schemaVersion: raw.schemaVersion ?? null,
    kind: raw.kind ?? null,
    ok: raw.ok === true,
    capturedAt: raw.capturedAt ?? null,
    ready: raw.ready === true,
    nextAction: raw.nextAction ?? null,
    fabricProfile: raw.fabricProfile ?? null,
    requiredDevices: Array.isArray(raw.requiredDevices) ? raw.requiredDevices : [],
    maintenanceActive: raw.maintenanceActive === true,
    hardware: {
      s3Present: hardware.s3Present === true,
      c5Present: hardware.c5Present === true,
      c5Required: hardware.c5Required === true,
      cometReachable: hardware.cometReachable === true,
      cometPath: hardware.cometPath ?? null,
    },
    acceptance: {
      ok: acceptance.ok === true,
      failedChecks: Array.isArray(acceptance.failedChecks) ? acceptance.failedChecks : [],
    },
    snapshot: { drift: snapshot.drift === true },
    physicalAcceptanceClaimed: false,
    physicalExecutionClaimed: false,
    rawShellExposed: false,
  };
}

function makeMcpServer(env: Env): McpServer {
  const server = new McpServer({ name: "EVAVO Workstation Relay", version: "0.3.1" });
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
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            online: status.online,
            capabilities: status.capabilities,
            workerFabricProfile: status.workerFabricProfile,
            dispatchRequiresSeparateAuthenticatedApi: true,
            typedReadDispatchAvailableThroughMcp: true,
            rawShellExposed: false,
          }),
        }],
      };
    },
  );
  server.registerTool(
    "gateway_fabric_status",
    {
      description: "Read the bounded EVAVO gateway hardware fabric, commissioning, Comet reachability and acceptance status. This fixed tool cannot type, click, move a pointer, wake a target or run arbitrary commands.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(publicGatewayFabricStatus(await internalGatewayFabricStatus(env))) }],
    }),
  );
  server.registerTool(
    "workstation_request_status",
    {
      description: "Read coarse state for a previously dispatched workstation request by opaque UUID. Detailed results are never exposed through this MCP tool.",
      inputSchema: { requestId: z.string().uuid() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ requestId }) => ({
      content: [{ type: "text", text: JSON.stringify(publicRequestStatus(await internalRequestStatus(env, requestId))) }],
    }),
  );
  return server;
}

export class WorkstationRelay extends DurableObject<Env> {
  private readonly pending = new Map<string, Pending>();

  private sockets(): WebSocket[] {
    return this.ctx.getWebSockets("workstation").filter((socket) => socket.readyState === WebSocket.OPEN);
  }

  private requestKey(id: string): string { return `request:${id}`; }

  private socketConnectionId(socket: WebSocket): string | null {
    try {
      const attachment = socket.deserializeAttachment() as Record<string, unknown> | null;
      return attachment && typeof attachment.connectionId === "string" ? attachment.connectionId : null;
    } catch {
      return null;
    }
  }

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
      deliveryJournalVersion: DELIVERY_JOURNAL_VERSION,
      automaticReplayOfUncertainEffect: false,
    };
  }

  private async updatePresence(message: Record<string, unknown>): Promise<void> {
    const old = await this.presence();
    const now = new Date().toISOString();
    const capabilities = Array.isArray(message.capabilities)
      ? message.capabilities.filter((value): value is string => typeof value === "string").slice(0, 64)
      : old?.capabilities ?? [];
    const newConnection = message.type === "connected";
    await this.ctx.storage.put("presence", {
      nodeId: typeof message.nodeId === "string" ? message.nodeId.slice(0, 128) : old?.nodeId ?? "windows-workstation",
      clientVersion: typeof message.clientVersion === "string" ? message.clientVersion.slice(0, 64) : old?.clientVersion ?? "unknown",
      runtimeRevision: typeof message.runtimeRevision === "string" ? message.runtimeRevision.slice(0, 64) : old?.runtimeRevision ?? null,
      workerFabricProfile: typeof message.workerFabricProfile === "string" ? message.workerFabricProfile.slice(0, 64) : old?.workerFabricProfile ?? null,
      capabilities,
      lastSeen: now,
      connectedAt: newConnection ? now : old?.connectedAt ?? now,
      lastReceiptKind: old?.lastReceiptKind ?? null,
      lastReceiptAt: old?.lastReceiptAt ?? null,
    } satisfies Presence);
  }

  private normalizeRecord(record: DispatchRecord): DispatchRecord {
    const effectful = isEffectful(record.action);
    const legacyDelivery = record.deliveryState == null;
    const terminal = record.status === "completed" || record.status === "failed";
    const deliveryState: DeliveryState = legacyDelivery
      ? (terminal ? "sent" : "send_attempted")
      : record.deliveryState;
    const status: DispatchStatus = legacyDelivery && record.status === "queued" ? "dispatching" : record.status;
    return {
      ...record,
      status,
      deliveryState,
      connectionId: record.connectionId ?? null,
      sentAt: record.sentAt ?? null,
      executionAttempted: record.executionAttempted ?? (terminal ? true : deliveryState === "not_sent" ? false : null),
      sideEffectMayHaveCommitted: record.sideEffectMayHaveCommitted ?? (effectful && deliveryState !== "not_sent"),
      effectState: record.effectState ?? (effectful ? (terminal ? "receipt_returned" : deliveryState === "not_sent" ? "not_attempted" : "unknown") : "not_applicable"),
      retrySafe: record.retrySafe ?? (!effectful || deliveryState === "not_sent"),
      terminalReason: record.terminalReason ?? (terminal ? "legacy-correlated-receipt" : null),
    };
  }

  private reconcileExpiredRecord(record: DispatchRecord, nowMs = Date.now()): DispatchRecord {
    const normalized = this.normalizeRecord(record);
    if (isTerminalStatus(normalized.status)) return normalized;
    const deadlineMs = Date.parse(normalized.deadline);
    if (!Number.isFinite(deadlineMs) || deadlineMs > nowMs) return normalized;
    const effectful = isEffectful(normalized.action);
    const completedAt = new Date(nowMs).toISOString();
    if (normalized.deliveryState === "not_sent") {
      return {
        ...normalized,
        status: "failed",
        completedAt,
        ok: false,
        executionAttempted: false,
        sideEffectMayHaveCommitted: false,
        effectState: effectful ? "not_attempted" : "not_applicable",
        retrySafe: true,
        terminalReason: "deadline-expired-before-send",
        error: "workstation-dispatch-expired-before-send",
      };
    }
    if (!effectful) {
      return {
        ...normalized,
        status: "failed",
        completedAt,
        ok: false,
        executionAttempted: normalized.executionAttempted ?? null,
        sideEffectMayHaveCommitted: false,
        effectState: "not_applicable",
        retrySafe: true,
        terminalReason: "read-deadline-without-correlated-receipt",
        error: "workstation-read-deadline-without-correlated-receipt",
      };
    }
    return {
      ...normalized,
      status: "ambiguous",
      completedAt,
      ok: null,
      executionAttempted: normalized.executionAttempted ?? null,
      sideEffectMayHaveCommitted: true,
      effectState: "unknown",
      retrySafe: false,
      terminalReason: "deadline-without-correlated-receipt",
      error: "workstation-effect-outcome-ambiguous",
    };
  }

  private async scheduleDeadline(deadline: string): Promise<void> {
    const deadlineMs = Date.parse(deadline);
    if (!Number.isFinite(deadlineMs)) return;
    const target = Math.max(Date.now() + 1, deadlineMs);
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || target < existing) await this.ctx.storage.setAlarm(target);
  }

  private async remember(record: DispatchRecord): Promise<void> {
    await this.ctx.storage.put(this.requestKey(record.id), record);
    const previous = (await this.ctx.storage.get<string[]>("request-index")) ?? [];
    const ids = [...previous.filter((id) => id !== record.id), record.id];
    const expired = ids.length > MAX_STORED_REQUESTS ? ids.splice(0, ids.length - MAX_STORED_REQUESTS) : [];
    if (expired.length) await Promise.all(expired.map((id) => this.ctx.storage.delete(this.requestKey(id))));
    await this.ctx.storage.put("request-index", ids);
    if (!isTerminalStatus(record.status)) await this.scheduleDeadline(record.deadline);
  }

  private async finish(message: ResultMessage, sourceConnectionId: string | null): Promise<void> {
    const oldPresence = await this.presence();
    if (oldPresence) {
      await this.ctx.storage.put("presence", {
        ...oldPresence,
        lastSeen: new Date().toISOString(),
        lastReceiptKind: message.action.slice(0, 128),
        lastReceiptAt: message.completedAt,
      } satisfies Presence);
    }
    const stored = await this.ctx.storage.get<DispatchRecord>(this.requestKey(message.id));
    if (!stored || stored.action !== message.action) return;
    const existing = this.normalizeRecord(stored);
    if (existing.deliveryState === "not_sent") return;
    if (existing.connectionId !== null && existing.connectionId !== sourceConnectionId) return;
    const effectful = isEffectful(existing.action);
    await this.remember({
      ...existing,
      status: message.ok ? "completed" : "failed",
      deliveryState: "sent",
      completedAt: message.completedAt,
      ok: message.ok,
      executionAttempted: true,
      sideEffectMayHaveCommitted: effectful,
      effectState: effectful ? "receipt_returned" : "not_applicable",
      retrySafe: !effectful,
      terminalReason: message.ok ? "correlated-success-receipt" : "correlated-failure-receipt",
      ...(message.result === undefined ? {} : { result: message.result }),
      ...(message.error === undefined ? {} : { error: message.error.slice(0, 1024) }),
    });
  }

  private async requestStatus(id: string): Promise<Response> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, error: "invalid-request-id" }, { status: 400 });
    const stored = await this.ctx.storage.get<DispatchRecord>(this.requestKey(id));
    if (!stored) return json({ ok: false, error: "request-not-found", requestId: id }, { status: 404 });
    const record = this.reconcileExpiredRecord(stored);
    await this.ctx.storage.put(this.requestKey(id), record);
    if (!isTerminalStatus(record.status)) await this.scheduleDeadline(record.deadline);
    return json({ ok: true, request: record });
  }

  private async dispatch(body: Record<string, unknown>): Promise<Response> {
    const sockets = this.sockets();
    if (sockets.length !== 1) {
      return json({ ok: false, error: sockets.length ? "multiple-workstations-connected" : "workstation-offline" }, { status: 503 });
    }
    const socket = sockets[0];
    const connectionId = this.socketConnectionId(socket);
    const action = typeof body.action === "string" ? body.action : "";
    if (!ACTIONS.has(action)) return json({ ok: false, error: "action-not-admitted" }, { status: 400 });
    const args = body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)
      ? body.arguments as Record<string, unknown>
      : {};
    if (STORAGE_ACTIONS.has(action) && Object.keys(args).length !== 0) {
      return json({ ok: false, error: "storage-actions-require-empty-arguments" }, { status: 400 });
    }
    if (GATEWAY_READ_ACTIONS.has(action) && Object.keys(args).length !== 0) {
      return json({ ok: false, error: "gateway-read-actions-require-empty-arguments" }, { status: 400 });
    }
    if (new TextEncoder().encode(JSON.stringify(args)).byteLength > MAX_DISPATCH_BYTES) {
      return json({ ok: false, error: "arguments-too-large" }, { status: 413 });
    }

    const requestedAt = new Date();
    const desired = Number(body.timeoutMs ?? (STORAGE_ACTIONS.has(action) ? MAX_DEADLINE_MS : 30_000));
    const deadlineMs = Math.min(MAX_DEADLINE_MS, Math.max(1_000, Number.isFinite(desired) ? desired : 30_000));
    const id = crypto.randomUUID();
    const deadline = new Date(requestedAt.getTime() + deadlineMs).toISOString();
    const message: DispatchMessage = {
      id,
      type: "dispatch",
      action,
      arguments: args,
      requestedAt: requestedAt.toISOString(),
      deadline,
    };
    const effectful = isEffectful(action);
    let record: DispatchRecord = {
      id,
      action,
      status: "queued",
      deliveryState: "not_sent",
      connectionId,
      requestedAt: message.requestedAt,
      deadline,
      sentAt: null,
      completedAt: null,
      ok: null,
      executionAttempted: false,
      sideEffectMayHaveCommitted: false,
      effectState: effectful ? "not_attempted" : "not_applicable",
      retrySafe: true,
      terminalReason: null,
    };
    await this.remember(record);

    if (socket.readyState !== WebSocket.OPEN) {
      record = {
        ...record,
        status: "failed",
        completedAt: new Date().toISOString(),
        ok: false,
        terminalReason: "socket-closed-before-send",
        error: "workstation-socket-closed-before-send",
      };
      await this.remember(record);
      return json({
        ok: false,
        id,
        action,
        status: record.status,
        deliveryState: record.deliveryState,
        retrySafe: record.retrySafe,
        sideEffectMayHaveCommitted: record.sideEffectMayHaveCommitted,
        error: record.error,
      }, { status: 503 });
    }

    record = {
      ...record,
      status: "dispatching",
      deliveryState: "send_attempted",
      executionAttempted: null,
      sideEffectMayHaveCommitted: effectful,
      effectState: effectful ? "unknown" : "not_applicable",
      retrySafe: !effectful,
    };
    await this.remember(record);

    const wait = typeof body.wait === "boolean" ? body.wait : !STORAGE_ACTIONS.has(action);
    const waitMs = Math.min(MAX_SYNC_WAIT_MS, deadlineMs);
    let resultPromise: Promise<ResultMessage> | null = null;
    if (wait) {
      resultPromise = new Promise<ResultMessage>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error("workstation-dispatch-timeout"));
        }, waitMs);
        this.pending.set(id, { resolve, reject, timer, socket, connectionId });
      });
    }

    try {
      socket.send(JSON.stringify(message));
      record = {
        ...record,
        status: "sent",
        deliveryState: "sent",
        sentAt: new Date().toISOString(),
      };
      await this.remember(record);
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
      }
      const errorText = error instanceof Error ? error.message.slice(0, 512) : "websocket-send-failed";
      record = effectful
        ? {
            ...record,
            status: "ambiguous",
            completedAt: new Date().toISOString(),
            ok: null,
            sideEffectMayHaveCommitted: true,
            effectState: "unknown",
            retrySafe: false,
            terminalReason: "send-threw-after-send-attempt",
            error: `workstation-dispatch-send-uncertain:${errorText}`,
          }
        : {
            ...record,
            status: "failed",
            completedAt: new Date().toISOString(),
            ok: false,
            sideEffectMayHaveCommitted: false,
            effectState: "not_applicable",
            retrySafe: true,
            terminalReason: "read-send-threw-after-send-attempt",
            error: `workstation-read-send-failed:${errorText}`,
          };
      await this.remember(record);
      return json({
        ok: effectful,
        id,
        action,
        status: record.status,
        deliveryState: record.deliveryState,
        pollingRequired: effectful,
        reconciliationRequired: effectful,
        sideEffectMayHaveCommitted: record.sideEffectMayHaveCommitted,
        retrySafe: record.retrySafe,
        automaticReplayAllowed: false,
        error: record.error,
      }, { status: effectful ? 202 : 503 });
    }

    if (!wait || resultPromise === null) {
      return json({
        ok: true,
        id,
        action,
        status: record.status,
        deliveryState: record.deliveryState,
        deadline,
        pollingRequired: true,
        sideEffectMayHaveCommitted: record.sideEffectMayHaveCommitted,
        retrySafe: record.retrySafe,
        automaticReplayAllowed: false,
      }, { status: 202 });
    }

    try {
      const result = await resultPromise;
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_RESULT_BYTES) {
        return json({ ok: false, error: "result-too-large", id }, { status: 502 });
      }
      return json(result, { status: result.ok ? 200 : 502 });
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
      }
      const stored = await this.ctx.storage.get<DispatchRecord>(this.requestKey(id));
      const current = stored ? this.reconcileExpiredRecord(stored) : record;
      if (stored) await this.ctx.storage.put(this.requestKey(id), current);
      return json({
        ok: true,
        id,
        action,
        status: current.status,
        deliveryState: current.deliveryState,
        pollingRequired: true,
        reconciliationRequired: current.status === "ambiguous",
        sideEffectMayHaveCommitted: current.sideEffectMayHaveCommitted,
        retrySafe: current.retrySafe,
        automaticReplayAllowed: false,
        error: error instanceof Error ? error.message : "dispatch-wait-ended",
      }, { status: 202 });
    }
  }

  async alarm(): Promise<void> {
    const ids = (await this.ctx.storage.get<string[]>("request-index")) ?? [];
    const now = Date.now();
    let nextDeadline: number | null = null;
    for (const id of ids) {
      const stored = await this.ctx.storage.get<DispatchRecord>(this.requestKey(id));
      if (!stored) continue;
      const record = this.reconcileExpiredRecord(stored, now);
      await this.ctx.storage.put(this.requestKey(id), record);
      if (!isTerminalStatus(record.status)) {
        const deadlineMs = Date.parse(record.deadline);
        if (Number.isFinite(deadlineMs) && deadlineMs > now) {
          nextDeadline = nextDeadline === null ? deadlineMs : Math.min(nextDeadline, deadlineMs);
        }
      }
    }
    if (nextDeadline === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(nextDeadline);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/status" && request.method === "GET") return json(await this.status());
    if (url.pathname === "/request" && request.method === "GET") return this.requestStatus(url.searchParams.get("id") ?? "");
    if (url.pathname === "/dispatch" && request.method === "POST") {
      return this.dispatch(await request.json() as Record<string, unknown>);
    }
    if (url.pathname === "/connect") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      for (const old of this.ctx.getWebSockets("workstation")) {
        try { old.close(4001, "superseded"); } catch { /* ignore */ }
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const connectedAt = new Date().toISOString();
      const connectionId = crypto.randomUUID();
      this.ctx.acceptWebSocket(server, ["workstation"]);
      server.serializeAttachment({ connectedAt, connectionId });
      await this.updatePresence({ type: "connected" });
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("Not Found", { status: 404 });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || new TextEncoder().encode(message).byteLength > MAX_RESULT_BYTES) return;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(message) as Record<string, unknown>; } catch { return; }
    if (parsed.type === "hello" || parsed.type === "heartbeat") {
      await this.updatePresence(parsed);
      return;
    }
    if (
      parsed.type !== "result"
      || typeof parsed.id !== "string"
      || typeof parsed.action !== "string"
      || typeof parsed.ok !== "boolean"
      || typeof parsed.completedAt !== "string"
      || !Number.isFinite(Date.parse(parsed.completedAt))
    ) return;
    const result = parsed as unknown as ResultMessage;
    const sourceConnectionId = this.socketConnectionId(socket);
    await this.finish(result, sourceConnectionId);
    const pending = this.pending.get(result.id);
    if (!pending || pending.socket !== socket) return;
    if (pending.connectionId !== null && pending.connectionId !== sourceConnectionId) return;
    clearTimeout(pending.timer);
    this.pending.delete(result.id);
    pending.resolve(result);
  }

  webSocketClose(socket: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    try { socket.close(code, reason); } catch { /* ignore */ }
    for (const [id, pending] of this.pending) {
      if (pending.socket !== socket) continue;
      clearTimeout(pending.timer);
      pending.reject(new Error("workstation-disconnected"));
      this.pending.delete(id);
    }
  }

  webSocketError(socket: WebSocket, _error: unknown): void {
    for (const [id, pending] of this.pending) {
      if (pending.socket !== socket) continue;
      clearTimeout(pending.timer);
      pending.reject(new Error("workstation-websocket-error"));
      this.pending.delete(id);
    }
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const relay = stub(env);
    if (url.pathname === "/connect") {
      const supplied = bearer(request);
      if (!supplied || !constantTimeEqual(supplied, env.WORKSTATION_TOKEN)) {
        return json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
      return relay.fetch(new Request("https://relay.internal/connect", { method: "GET", headers: request.headers }));
    }
    if (url.pathname === "/api/dispatch") {
      const supplied = bearer(request);
      if (!supplied || !constantTimeEqual(supplied, env.DISPATCH_TOKEN)) {
        return json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
      if (request.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, { status: 405 });
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_DISPATCH_BYTES) {
        return json({ ok: false, error: "body-too-large" }, { status: 413 });
      }
      return relay.fetch(new Request("https://relay.internal/dispatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }));
    }
    if (url.pathname === "/api/request" && request.method === "GET") {
      const supplied = bearer(request);
      if (!supplied || !constantTimeEqual(supplied, env.DISPATCH_TOKEN)) {
        return json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
      const internal = new URL("https://relay.internal/request");
      internal.searchParams.set("id", url.searchParams.get("id") ?? "");
      return relay.fetch(internal);
    }
    if (url.pathname === "/api/status" && request.method === "GET") {
      return json(publicStatus(await internalStatus(env)));
    }
    if (url.pathname === "/health" && request.method === "GET") {
      const status = publicStatus(await internalStatus(env));
      return json({
        ok: true,
        service: "evavo-workstation-mcp-relay",
        workstationOnline: status.online,
        deliveryJournalVersion: DELIVERY_JOURNAL_VERSION,
        automaticReplayOfUncertainEffect: false,
      });
    }
    if (url.pathname === "/mcp") {
      return createMcpHandler(() => makeMcpServer(env), {
        route: "/mcp",
        responseMode: "json",
        legacy: "stateless",
      })(request, env, ctx);
    }
    return new Response("EVAVO workstation MCP relay", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
