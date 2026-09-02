import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "mcp-server", "local-agent-mcp-v2.mjs"), "utf8");

test("v2 exposes routing, submit-wait, and status surfaces", () => {
  for (const name of [
    "evavo_workstation_fabric_status",
    "evavo_workstation_route_task",
    "evavo_workstation_submit_and_wait",
    "evavo_workstation_job_status",
  ]) assert.match(source, new RegExp(name));
});

test("v2 uses the canonical Local Compute queue and authoritative terminal receipts", () => {
  assert.match(source, /EVAVO-STUDIO\/evavo-local-compute/u);
  assert.match(source, /\[EVAVO LOCAL EXEC\]/u);
  assert.match(source, /receiptIsOutcomeAuthority/u);
  assert.match(source, /terminalReceiptRequired: true/u);
  assert.match(source, /closedIssueAloneMeansSuccess: false/u);
});

test("v2 does not admit raw opaque shell fields", () => {
  assert.match(source, /delete request\.command/u);
  assert.match(source, /delete request\.shell/u);
  assert.match(source, /delete request\.inlineCode/u);
  assert.match(source, /rawOpaqueShellIsCanonical: false/u);
  assert.match(source, /shaBoundScriptFallback: true/u);
});

test("v2 preserves multi-agent and ambiguous-effect safety", () => {
  assert.match(source, /maximumConcurrentMutationWritersPerRoot: 1/u);
  assert.match(source, /correctedRetryRequiresNewId: true/u);
  assert.match(source, /blindReplayAfterPossibleEffect: false/u);
  assert.match(source, /The queue job may still be executing; do not submit a duplicate/u);
});

test("v2 routing retains specialized authority boundaries", () => {
  assert.match(source, /evavo-computer-agent/u);
  assert.match(source, /evavo-local-ai-agent-gateway/u);
  assert.match(source, /evavo-out-of-band-control/u);
  assert.match(source, /network-studio/u);
  assert.match(source, /evavo-model-lab/u);
  assert.match(source, /evavo-development-studio/u);
});
