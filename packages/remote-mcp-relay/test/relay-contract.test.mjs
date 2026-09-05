import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");
const compatibilitySource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const deploy = readFileSync(new URL("../../../scripts/Deploy-EvavoRemoteMcpRelay.ps1", import.meta.url), "utf8");
const deployV2 = readFileSync(new URL("../../../scripts/Deploy-EvavoRemoteMcpRelayV2.ps1", import.meta.url), "utf8");

test("Wrangler worker is the single authoritative implementation", () => {
  assert.match(wrangler, /"main": "src\/worker\.ts"/);
  assert.match(compatibilitySource, /export \{ WorkstationRelay \} from "\.\/worker"/);
  assert.match(compatibilitySource, /export \{ default \} from "\.\/worker"/);
  assert.doesNotMatch(compatibilitySource, /DurableObject|registerTool|api\/dispatch|execution\.prepare/);
});

test("remote MCP exposes only bounded read-only workstation and gateway tools", () => {
  assert.match(source, /workstation_status/);
  assert.match(source, /workstation_capabilities/);
  assert.match(source, /gateway_fabric_status/);
  assert.match(source, /workstation_request_status/);
  assert.match(source, /readOnlyHint:\s*true/g);
  assert.doesNotMatch(source, /registerTool\(\s*["'](?:dispatch|execute|powershell|shell)/i);
  assert.match(source, /dispatchExposedThroughProMcp:\s*false/);
  assert.match(source, /typedReadDispatchExposedThroughProMcp:\s*true/);
  assert.match(source, /rawShellExposed:\s*false/);
});

test("gateway fabric MCP tool is a fixed empty-argument read and cannot become HID control", () => {
  assert.match(source, /const GATEWAY_READ_ACTIONS = new Set/);
  assert.match(source, /gateway\.fabric_status/);
  assert.match(source, /gateway-read-actions-require-empty-arguments/);
  assert.match(source, /action: "gateway\.fabric_status", arguments: \{\}, wait: true/);
  assert.match(source, /physicalAcceptanceClaimed:\s*false/);
  assert.match(source, /physicalExecutionClaimed:\s*false/);
  for (const prohibited of ["gateway.type_text", "gateway.press_keys", "gateway.move_mouse", "gateway.wake_target"]) {
    assert.doesNotMatch(source, new RegExp(prohibited.replaceAll(".", "\\.")));
  }
});

test("public MCP request status is coarse and cannot expose execution output", () => {
  const start = source.indexOf("function publicRequestStatus");
  const end = source.indexOf("async function internalGatewayFabricStatus");
  assert.ok(start >= 0 && end > start);
  const redaction = source.slice(start, end);
  assert.match(redaction, /detailedResultExposedThroughMcp:\s*false/);
  assert.match(redaction, /sideEffectMayHaveCommitted/);
  assert.match(redaction, /retrySafe/);
  assert.match(redaction, /deliveryState/);
  assert.doesNotMatch(redaction, /request\.result|request\.error|raw\.result/);
  assert.match(source, /publicRequestStatus\(await internalRequestStatus/);
  assert.match(source, /\/api\/request/);
  assert.match(source, /DISPATCH_TOKEN/);
});

test("MCP v2 tool schemas use raw Zod shapes and package versions agree", () => {
  assert.match(source, /inputSchema:\s*\{\s*requestId:\s*z\.string\(\)\.uuid\(\)\s*\}/);
  assert.doesNotMatch(source, /inputSchema:\s*z\.object/);
  assert.equal(packageJson.dependencies["@modelcontextprotocol/server"], "2.0.0");
  assert.equal(packageJson.dependencies.agents, "^0.21.0");
  const serverVersion = source.match(/new McpServer\(\{ name: "EVAVO Workstation Relay", version: "([^"]+)" \}\)/)?.[1];
  assert.equal(serverVersion, packageJson.version);
});

test("effectful dispatch is separately authenticated, typed and end-to-end implemented", () => {
  assert.match(source, /\/api\/dispatch/);
  assert.match(source, /DISPATCH_TOKEN/);
  assert.match(source, /const ACTIONS = new Set/);
  for (const action of [
    "workstation.status",
    "workstation.repair",
    "workstation.bootstrap",
    "rest.health",
    "gateway.fabric_status",
    "storage.status",
    "storage.inventory.refresh",
    "storage.google_pressure.activate",
    "storage.estate.activate",
  ]) assert.match(source, new RegExp(action.replaceAll(".", "\\.")));
  for (const reserved of ["execution.prepare", "execution.run_request", "godot.runtime_probe"]) {
    assert.doesNotMatch(source, new RegExp(reserved.replaceAll(".", "\\.")));
  }
  assert.match(source, /action-not-admitted/);
  assert.doesNotMatch(source, /powershell\.command/i);
  assert.doesNotMatch(source, /shell\.command/i);
});

test("delivery journal distinguishes never-sent, attempted, sent and ambiguous outcomes", () => {
  assert.match(source, /type DeliveryState = "not_sent" \| "send_attempted" \| "sent"/);
  assert.match(source, /type DispatchStatus = "queued" \| "dispatching" \| "sent" \| "completed" \| "failed" \| "ambiguous"/);
  assert.match(source, /DELIVERY_JOURNAL_VERSION = 1/);
  assert.match(source, /sideEffectMayHaveCommitted/);
  assert.match(source, /effectState/);
  assert.match(source, /retrySafe/);
  assert.match(source, /deadline-expired-before-send/);
  assert.match(source, /deadline-without-correlated-receipt/);
  assert.match(source, /workstation-effect-outcome-ambiguous/);
  assert.match(source, /automaticReplayAllowed:\s*false/);
  assert.match(source, /automaticReplayOfUncertainEffect:\s*false/);
});

test("write-ahead delivery state and waiter are persisted before websocket send", () => {
  const start = source.indexOf("private async dispatch");
  const end = source.indexOf("async alarm()", start);
  assert.ok(start >= 0 && end > start);
  const dispatch = source.slice(start, end);
  const queued = dispatch.indexOf('deliveryState: "not_sent"');
  const attempted = dispatch.indexOf('deliveryState: "send_attempted"');
  const waiter = dispatch.indexOf("this.pending.set");
  const send = dispatch.indexOf("socket.send");
  const sent = dispatch.indexOf('deliveryState: "sent"', send);
  assert.ok(queued >= 0 && attempted > queued, "not_sent must precede send_attempted");
  assert.ok(waiter > attempted && waiter < send, "sync waiter must exist before send");
  assert.ok(send > attempted, "send attempt journal must be durable before send");
  assert.ok(sent > send, "sent state can only be persisted after send returns");
});

test("Durable Object alarm reconciles abandoned requests without polling", () => {
  assert.match(source, /getAlarm\(\)/);
  assert.match(source, /setAlarm\(/);
  assert.match(source, /deleteAlarm\(\)/);
  assert.match(source, /async alarm\(\): Promise<void>/);
  const alarmStart = source.indexOf("async alarm(): Promise<void>");
  const alarmEnd = source.indexOf("async fetch(request", alarmStart);
  assert.ok(alarmStart >= 0 && alarmEnd > alarmStart);
  const alarm = source.slice(alarmStart, alarmEnd);
  assert.match(alarm, /reconcileExpiredRecord/);
  assert.match(alarm, /request-index/);
});

test("legacy queued records migrate conservatively and are never assumed unsent", () => {
  const start = source.indexOf("private normalizeRecord");
  const end = source.indexOf("private reconcileExpiredRecord", start);
  assert.ok(start >= 0 && end > start);
  const normalize = source.slice(start, end);
  assert.match(normalize, /legacyDelivery/);
  assert.match(normalize, /"send_attempted"/);
  assert.match(normalize, /record\.status === "queued" \? "dispatching"/);
  assert.doesNotMatch(normalize, /legacyDelivery[^\n]+"not_sent"/);
});

test("receipt must correlate before terminal storage and caller settlement", () => {
  const finishStart = source.indexOf("private async finish");
  const finishEnd = source.indexOf("private async requestStatus", finishStart);
  assert.ok(finishStart >= 0 && finishEnd > finishStart);
  const finish = source.slice(finishStart, finishEnd);
  assert.match(finish, /stored\.action !== message\.action/);
  assert.match(finish, /existing\.connectionId !== sourceConnectionId/);
  assert.match(finish, /existing\.status === "completed" \|\| existing\.status === "failed"/);
  const durableTerminal = finish.indexOf("await this.remember");
  const presenceUpdate = finish.indexOf('this.ctx.storage.put("presence"');
  assert.ok(durableTerminal >= 0 && presenceUpdate > durableTerminal, "receipt health metadata follows durable terminal journal");

  const messageStart = source.indexOf("async webSocketMessage");
  const messageEnd = source.indexOf("webSocketClose", messageStart);
  assert.ok(messageStart >= 0 && messageEnd > messageStart);
  const handler = source.slice(messageStart, messageEnd);
  const finishCall = handler.indexOf("const accepted = await this.finish");
  const acceptedGuard = handler.indexOf("if (!accepted) return");
  const resolveCall = handler.indexOf("pending.resolve");
  assert.ok(finishCall >= 0 && acceptedGuard > finishCall && resolveCall > acceptedGuard, "caller settles only after accepted durable receipt");
  assert.match(handler, /pending\.action !== result\.action/);
});

test("receipts and disconnects are bound to the workstation connection that received the request", () => {
  assert.match(source, /connectionId = crypto\.randomUUID\(\)/);
  assert.match(source, /serializeAttachment\(\{ connectedAt, connectionId \}\)/);
  assert.match(source, /deserializeAttachment\(\)/);
  assert.match(source, /connectionId:\s*string \| null/);
  assert.match(source, /pending\.socket !== socket/);
  assert.match(source, /pending\.connectionId !== sourceConnectionId/);
  const closeStart = source.indexOf("webSocketClose");
  const closeEnd = source.indexOf("webSocketError", closeStart);
  assert.ok(closeStart >= 0 && closeEnd > closeStart);
  assert.match(source.slice(closeStart, closeEnd), /if \(pending\.socket !== socket\) continue/);
});

test("workstation connection is outbound hibernating websocket with independent token", () => {
  assert.match(source, /\/connect/);
  assert.match(source, /WORKSTATION_TOKEN/);
  assert.match(source, /acceptWebSocket\(server, \["workstation"\]\)/);
  assert.match(source, /getWebSockets\("workstation"\)/);
  assert.match(source, /serializeAttachment/);
  assert.match(source, /new Request\("https:\/\/relay\.internal\/connect", \{ method: "GET", headers: request\.headers \}\)/);
});

test("request history is explicitly bounded without unsupported storage TTL options", () => {
  assert.match(source, /MAX_STORED_REQUESTS = 256/);
  assert.match(source, /request-index/);
  assert.match(source, /storage\.delete/);
  assert.doesNotMatch(source, /expirationTtl/);
});

test("Cloudflare config deploys the compile-safe Worker and SQLite Durable Object", () => {
  assert.match(wrangler, /"main": "src\/worker\.ts"/);
  assert.match(wrangler, /"WORKSTATION_RELAY"/);
  assert.match(wrangler, /"WorkstationRelay"/);
  assert.match(wrangler, /"new_sqlite_classes"/);
  assert.doesNotMatch(wrangler, /kv_namespaces/i);
});

test("deployment requires a live workstation connection when client installation is requested", () => {
  assert.match(deploy, /EVAVO_REMOTE_MCP_RELAY_DEPLOY_WORKSTATION_DID_NOT_CONNECT/);
  assert.match(deploy, /workstationOnline/);
  assert.match(deploy, /physicalWorkstationConnectionProven=\$ConnectionProven/);
  assert.match(deploy, /dispatchCallerCredentialProvisioned=\$false/);
  assert.match(deploy, /effectfulDispatchReadyForExternalCaller=\$false/);
  assert.doesNotMatch(deploy, /\$LASTEXITCODE\s*-ne\s*0\s*-or\s*-not\s*\$InstallResult/);
  assert.match(deploy, /WorkstationToken \$Secure -StartNow/);
});

test("canonical deploy wrapper selects an admitted current Local Storage checkout", () => {
  assert.match(deployV2, /Test-AdmittedLocalStorageSource/);
  assert.match(deployV2, /zero-cost-updater\\runtime\\evavo-local-storage/);
  assert.match(deployV2, /zero-cost-recovery\\runtime\\evavo-local-storage/);
  assert.match(deployV2, /zero-cost-logon-guardian\\runtime\\evavo-local-storage/);
  assert.match(deployV2, /refs\/remotes\/origin\/main/);
  assert.match(deployV2, /fetch --no-tags origin main/);
  assert.match(deployV2, /EVAVO_REMOTE_MCP_RELAY_DEPLOY_V2_NO_ADMITTED_LOCAL_STORAGE_SOURCE/);
  assert.match(deployV2, /localStorageSourcePathReturned=\$false/);
  assert.doesNotMatch(deployV2, /reset --hard/i);
  assert.doesNotMatch(deployV2, /git clean/i);
});

test("deployment keeps generated relay secrets out of receipts", () => {
  assert.match(deploy, /workstationSecretReturned=\$false/);
  assert.match(deploy, /dispatchSecretReturned=\$false/);
  assert.match(deploy, /wrangler secret put/);
  assert.doesNotMatch(deploy, /Write-Host\s+\$WorkstationSecret/i);
  assert.doesNotMatch(deploy, /Write-Host\s+\$DispatchSecret/i);
  assert.match(deployV2, /cloudflareCredentialValueReturned=\$false/);
  assert.match(deployV2, /cloudflareAccountIdReturned=\$false/);
});

test("documentation keeps local executors private and plan boundaries explicit", () => {
  assert.match(readme, /REST Executor v5 and Local Agent remain loopback-only/);
  assert.match(readme, /ChatGPT Pro custom MCP access is limited to read\/fetch permissions/);
  assert.match(readme, /No raw PowerShell or arbitrary command string/);
  assert.match(readme, /paid overage is not a required recovery assumption/);
  assert.match(readme, /Detailed request results require the authenticated API/);
});
