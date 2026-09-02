import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../mcp-server/local-agent-mcp-v2.1.mjs", import.meta.url), "utf8");

test("v2.1 rejects raw shell-shaped object fields", () => {
  for (const key of ["command", "commandText", "shell", "shellCommand", "inlineCode"]) {
    assert.match(source, new RegExp(`\\"${key}\\"`));
  }
  assert.match(source, /FORBIDDEN_OBJECT_KEYS/);
  assert.match(source, /rejectForbiddenObjectKeys\(rawRequest\)/);
  assert.match(source, /reviewed SHA-bound script/);
});

test("v2.1 submits large structured issue bodies over stdin JSON", () => {
  assert.match(source, /gh api --input - JSON stdin/);
  assert.match(source, /"--input", "-"/);
  assert.match(source, /stdinText: apiDocument/);
  assert.doesNotMatch(source, /`body=\$\{body\}`/);
});

test("v2.1 exposes the canonical specialist routing matrix", () => {
  for (const marker of [
    'storage: "EVAVO-STUDIO/evavo-local-storage"',
    'beestation: "EVAVO-STUDIO/evavo-local-storage"',
    'externalStorage: "EVAVO-STUDIO/evavo-local-storage"',
    'immutableStorage: "EVAVO-STUDIO/evavo-storage"',
    'googleDrive: "provider-native:Google_Drive"',
    'modelTraining: "EVAVO-STUDIO/evavo-model-lab"',
    'gui: "EVAVO-STUDIO/evavo-computer-agent"',
    'physicalConsole: "EVAVO-STUDIO/evavo-local-ai-agent-gateway"',
  ]) assert.ok(source.includes(marker), marker);
});

test("v2.1 keeps timeout and ambiguous-effect retry semantics fail-closed", () => {
  assert.match(source, /safeAutomaticReplay: false/);
  assert.match(source, /The queue job may still be executing; do not submit a duplicate/);
  assert.match(source, /maximumConcurrentMutationWritersPerRoot: 1/);
  assert.match(source, /terminalReceiptRequired: true/);
});
