import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

test("storage relay actions are typed and zero-argument", () => {
  for (const action of [
    "storage.status",
    "storage.inventory.refresh",
    "storage.google_pressure.activate",
    "storage.estate.activate",
  ]) assert.match(source, new RegExp(action.replaceAll(".", "\\.")));
  assert.match(source, /STORAGE_ACTIONS/);
  assert.match(source, /storage-actions-require-empty-arguments/);
  assert.doesNotMatch(source, /STORAGE_ACTIONS[\s\S]*powershell\.command/i);
});

test("long storage dispatch is durable and pollable", () => {
  assert.match(source, /DispatchRecord/);
  assert.match(source, /request:\$\{id\}/);
  assert.match(source, /REQUEST_RETENTION_SECONDS/);
  assert.match(source, /status:\s*"queued"/);
  assert.match(source, /\/api\/request/);
  assert.match(source, /workstation_request_status/);
  assert.match(source, /pollingRequired:\s*true/);
  assert.match(source, /STORAGE_ACTIONS\.has\(action\).*!STORAGE_ACTIONS\.has\(action\)/s);
});

test("Pro MCP remains read-only", () => {
  assert.match(source, /dispatchExposedThroughProMcp:\s*false/);
  assert.match(source, /workstation_request_status/);
  assert.doesNotMatch(source, /registerTool\(\s*["'](?:dispatch|execute|shell|powershell)/i);
});
