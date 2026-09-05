import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

function sliceBetween(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing start: ${startNeedle}`);
  assert.ok(end > start, `missing end: ${endNeedle}`);
  return source.slice(start, end);
}

test("relay uses a write-ahead delivery journal with conservative effect truth", () => {
  assert.match(source, /type DeliveryState = "not_sent" \| "send_attempted" \| "sent"/);
  assert.match(source, /type DispatchStatus = "queued" \| "dispatching" \| "sent" \| "completed" \| "failed" \| "ambiguous"/);
  assert.match(source, /DELIVERY_JOURNAL_VERSION = 1/);
  assert.match(source, /sideEffectMayHaveCommitted/);
  assert.match(source, /executionAttempted/);
  assert.match(source, /retrySafe/);
  assert.match(source, /effectState/);
  assert.match(source, /automaticReplayOfUncertainEffect:\s*false/);
  assert.match(source, /automaticReplayAllowed:\s*false/);
});

test("effectful deadline without receipt becomes ambiguous and non-replayable", () => {
  const reconcile = sliceBetween("private reconcileExpiredRecord", "private async scheduleDeadline");
  assert.match(reconcile, /deliveryState === "not_sent"/);
  assert.match(reconcile, /executionAttempted:\s*false/);
  assert.match(reconcile, /sideEffectMayHaveCommitted:\s*false/);
  assert.match(reconcile, /retrySafe:\s*true/);
  assert.match(reconcile, /status:\s*"ambiguous"/);
  assert.match(reconcile, /sideEffectMayHaveCommitted:\s*true/);
  assert.match(reconcile, /effectState:\s*"unknown"/);
  assert.match(reconcile, /retrySafe:\s*false/);
  assert.match(reconcile, /deadline-without-correlated-receipt/);
});

test("dispatch journal and waiter precede websocket send", () => {
  const dispatch = sliceBetween("private async dispatch", "async alarm(): Promise<void>");
  const queued = dispatch.indexOf('deliveryState: "not_sent"');
  const attempted = dispatch.indexOf('deliveryState: "send_attempted"');
  const waiter = dispatch.indexOf("this.pending.set");
  const send = dispatch.indexOf("socket.send");
  const sent = dispatch.indexOf('deliveryState: "sent"', send);
  assert.ok(queued >= 0 && attempted > queued);
  assert.ok(waiter > attempted && waiter < send);
  assert.ok(send > attempted);
  assert.ok(sent > send);
});

test("terminal receipt is durable and correlated before waiter resolution", () => {
  const finish = sliceBetween("private async finish", "private async requestStatus");
  assert.match(finish, /stored\.action !== message\.action/);
  assert.match(finish, /existing\.connectionId !== sourceConnectionId/);
  assert.match(finish, /existing\.status === "completed" \|\| existing\.status === "failed"/);
  assert.match(finish, /Promise<boolean>/);
  assert.ok(finish.indexOf("await this.remember") < finish.indexOf('this.ctx.storage.put("presence"'));

  const handler = sliceBetween("async webSocketMessage", "webSocketClose");
  assert.ok(handler.indexOf("const accepted = await this.finish") < handler.indexOf("if (!accepted) return"));
  assert.ok(handler.indexOf("if (!accepted) return") < handler.indexOf("pending.resolve"));
  assert.match(handler, /pending\.action !== result\.action/);
  assert.match(handler, /pending\.connectionId !== sourceConnectionId/);
});

test("dispatch requires a journal-capable connection and old sockets must reconnect", () => {
  const dispatch = sliceBetween("private async dispatch", "async alarm(): Promise<void>");
  assert.match(dispatch, /connectionId === null/);
  assert.match(dispatch, /workstation-connection-needs-journal-reconnect/);
  assert.match(dispatch, /reconnectRequired:\s*true/);
  assert.match(dispatch, /executionAttempted:\s*false/);
  assert.match(dispatch, /sideEffectMayHaveCommitted:\s*false/);
  assert.match(source, /journalReady/);
  assert.match(source, /connectionId = crypto\.randomUUID\(\)/);
  assert.match(source, /serializeAttachment\(\{ connectedAt, connectionId \}\)/);
  assert.match(source, /deserializeAttachment\(\)/);
});

test("a superseded socket cannot cancel or settle replacement-socket work", () => {
  const handler = sliceBetween("async webSocketMessage", "webSocketClose");
  const closeHandler = sliceBetween("webSocketClose", "webSocketError");
  assert.match(handler, /pending\.socket !== socket/);
  assert.match(closeHandler, /if \(pending\.socket !== socket\) continue/);
  assert.match(source, /socket:\s*WebSocket/);
  assert.match(source, /connectionId:\s*string \| null/);
});

test("legacy queued history is migrated conservatively", () => {
  const normalize = sliceBetween("private normalizeRecord", "private reconcileExpiredRecord");
  assert.match(normalize, /legacyDelivery/);
  assert.match(normalize, /terminal \? "sent" : "send_attempted"/);
  assert.match(normalize, /record\.status === "queued" \? "dispatching"/);
});

test("Durable Object alarms reconcile abandoned requests", () => {
  assert.match(source, /getAlarm\(\)/);
  assert.match(source, /setAlarm\(/);
  assert.match(source, /deleteAlarm\(\)/);
  const alarm = sliceBetween("async alarm(): Promise<void>", "async fetch(request");
  assert.match(alarm, /request-index/);
  assert.match(alarm, /reconcileExpiredRecord/);
});

test("documentation forbids blind replay and external desktop fallback", () => {
  assert.match(readme, /automatic replay of an uncertain effect is never allowed/i);
  assert.match(readme, /Desktop Commander and other external desktop-control products are not part/i);
  assert.match(readme, /transport acceptance is never treated as physical success/i);
  assert.match(readme, /reconcile/i);
});
