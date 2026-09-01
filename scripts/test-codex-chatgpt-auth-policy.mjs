#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { probeCodexChatgptAuthPolicy } from "./probe-codex-chatgpt-auth-policy.mjs";

const now = new Date("2026-09-01T02:40:00.000Z");

function runCase({config = null, requirements = null}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-codex-auth-policy-"));
  const configPath = path.join(root, "config.toml");
  const requirementsPath = path.join(root, "requirements.toml");
  if (config !== null) fs.writeFileSync(configPath, config);
  if (requirements !== null) fs.writeFileSync(requirementsPath, requirements);
  try {
    return probeCodexChatgptAuthPolicy({userConfigPath:configPath, systemRequirementsPath:requirementsPath, now});
  } finally {
    fs.rmSync(root, {recursive:true, force:true});
  }
}

const userForced = runCase({config:'forced_login_method = "chatgpt"\n'});
assert.equal(userForced.accepted, true);
assert.equal(userForced.authenticationClass, "chatgpt-consumer");
assert.equal(userForced.enforcement, "user-config-forced-chatgpt");
assert.equal(userForced.credentialsRead, false);

const systemForced = runCase({requirements:'allowed_login_methods = ["chatgpt"]\n'});
assert.equal(systemForced.accepted, true);
assert.equal(systemForced.enforcement, "system-requirements-chatgpt-only");

for (const rejected of [
  runCase({config:'forced_login_method = "api"\n'}),
  runCase({requirements:'allowed_login_methods = ["chatgpt", "api"]\n'}),
  runCase({config:'# forced_login_method = "chatgpt"\n'}),
  runCase({}),
]) {
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.authenticationClass, "unproven");
}

console.log("Codex ChatGPT authentication policy tests passed.");
console.log("- ChatGPT-only user/system policy is recognized without reading credentials");
console.log("- API or mixed login policy is rejected for included-consumer Spark acceptance");
