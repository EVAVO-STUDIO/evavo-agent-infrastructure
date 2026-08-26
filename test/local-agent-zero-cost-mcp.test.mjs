import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../mcp-server/local-agent-zero-cost-mcp.mjs", import.meta.url), "utf8");

test("zero-cost launcher prefers the managed Local Storage checkout", () => {
  assert.match(source, /zero-cost-updater/);
  assert.match(source, /WorkerControlPlane/);
  assert.match(source, /manage-autonomous-node\.ps1/);
  assert.match(source, /zero-cost-managed-checkout/);
  assert.match(source, /development-checkout-compatibility-fallback/);
});

test("zero-cost launcher advertises canonical recovery tasks", () => {
  assert.match(source, /EVAVO Zero Cost Worker Recovery/);
  assert.match(source, /EVAVO Zero Cost Trusted Updater/);
  assert.match(source, /zero-cost-scheduled-tasks/);
  assert.doesNotMatch(source, /actions\/runners/);
  assert.doesNotMatch(source, /workflow_dispatch/);
});
