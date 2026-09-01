#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const compiler = path.join(root, "scripts", "compile-codex-chatgpt-auth-observation.mjs");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-codex-auth-observation-"));
const write = (value) => {
  const file = path.join(temporary, `probe-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
};
const invoke = (value, expectedStatus = 0) => {
  const result = spawnSync(process.execPath, [compiler, write(value)], { cwd: root, encoding: "utf8", shell: false });
  assert.equal(result.status, expectedStatus, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  return expectedStatus === 0 ? JSON.parse(result.stdout) : result;
};
const base = (patch = {}) => ({
  schemaVersion: 1,
  kind: "evavo-codex-chatgpt-auth-policy-probe-v1",
  observedAt: new Date().toISOString(),
  credentialValuesRead: false,
  ...patch,
});

try {
  let receipt = invoke(base({ accepted: true, authenticationClass: "chatgpt-consumer" }));
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.authenticationClass, "chatgpt-consumer");
  assert.equal(receipt.chatgptOnly, true);
  assert.equal(receipt.apiKeyAllowed, false);
  assert.equal(receipt.credentialValuesRead, false);
  assert.match(receipt.sourceReceiptSha256, /^[0-9a-f]{64}$/);

  receipt = invoke(base({ forcedLoginMethod: "chatgpt" }));
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.forcedLoginMethod, "chatgpt");

  receipt = invoke(base({ allowedLoginMethods: ["chatgpt"] }));
  assert.equal(receipt.accepted, true);
  assert.deepEqual(receipt.allowedLoginMethods, ["chatgpt"]);

  receipt = invoke(base({ allowedLoginMethods: ["chatgpt", "api"] }));
  assert.equal(receipt.accepted, false);
  assert.ok(receipt.rejectionReasons.includes("api-or-mixed-login-permitted"));

  receipt = invoke(base({ accepted: true, apiKeyAllowed: true }));
  assert.equal(receipt.accepted, false);
  assert.ok(receipt.rejectionReasons.includes("api-or-mixed-login-permitted"));

  receipt = invoke(base({ accepted: true, credentialValuesRead: true }));
  assert.equal(receipt.accepted, false);
  assert.ok(receipt.rejectionReasons.includes("credential-values-read"));
  assert.equal(receipt.credentialValuesRead, false);
  assert.equal(receipt.credentialValuesReturned, false);

  let failed = invoke(base({ observedAt: new Date(Date.now() - 20 * 60_000).toISOString(), accepted: true }), 1);
  assert.match(failed.stderr, /stale/i);

  failed = invoke({ schemaVersion: 1, kind: "unrelated", observedAt: new Date().toISOString(), accepted: true }, 1);
  assert.match(failed.stderr, /kind\/schema/i);

  console.log("Codex ChatGPT authentication-observation tests passed.");
  console.log("- explicit, forced and allowed-method ChatGPT-only policies normalize correctly");
  console.log("- API/mixed login and any credential-value read prevent acceptance");
  console.log("- stale and unrelated probe evidence fail closed without login or model execution");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
