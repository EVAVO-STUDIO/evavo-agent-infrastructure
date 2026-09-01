#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function regularTextFile(file) {
  if (!file || !fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Codex policy file must be a regular non-symlink file: ${file}`);
  const real = fs.realpathSync.native(file);
  const text = fs.readFileSync(real, "utf8");
  return {path: real, text, sha256: sha256(text), bytes: Buffer.byteLength(text, "utf8")};
}

function activeLines(text) {
  return text.split(/\r?\n/u)
    .map((line) => line.replace(/#.*$/u, "").trim())
    .filter(Boolean);
}

function forcedChatgpt(text) {
  return activeLines(text).some((line) => /^forced_login_method\s*=\s*["']chatgpt["']\s*$/iu.test(line));
}

function requirementsChatgptOnly(text) {
  for (const line of activeLines(text)) {
    const match = line.match(/^allowed_login_methods\s*=\s*\[(.*)\]\s*$/iu);
    if (!match) continue;
    const values = [...match[1].matchAll(/["']([^"']+)["']/gu)].map((entry) => entry[1].trim().toLowerCase());
    return values.length === 1 && values[0] === "chatgpt";
  }
  return false;
}

export function probeCodexChatgptAuthPolicy({userConfigPath, systemRequirementsPath, now = new Date()}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Auth-policy probe clock is invalid.");
  let userConfig = null;
  let requirements = null;
  let error = null;
  try {
    userConfig = regularTextFile(userConfigPath);
    requirements = regularTextFile(systemRequirementsPath);
  } catch (caught) {
    error = String(caught instanceof Error ? caught.message : caught).slice(0, 1024);
  }

  const userForced = userConfig ? forcedChatgpt(userConfig.text) : false;
  const systemOnly = requirements ? requirementsChatgptOnly(requirements.text) : false;
  const accepted = error === null && (systemOnly || userForced);
  const enforcement = systemOnly ? "system-requirements-chatgpt-only" : userForced ? "user-config-forced-chatgpt" : "not-proven";

  return Object.freeze({
    schemaVersion: 1,
    kind: "evavo-codex-chatgpt-auth-policy-probe-v1",
    observedAt: now.toISOString(),
    accepted,
    authenticationClass: accepted ? "chatgpt-consumer" : "unproven",
    enforcement,
    userConfig: userConfig ? {present:true, sha256:userConfig.sha256, bytes:userConfig.bytes, forcedLoginMethodChatgpt:userForced} : {present:false},
    systemRequirements: requirements ? {present:true, sha256:requirements.sha256, bytes:requirements.bytes, chatgptOnly:systemOnly} : {present:false},
    credentialsRead: false,
    apiKeyRead: false,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    error,
    truthBoundary: "This probe reads only Codex policy/config text and never reads stored credentials. A ChatGPT-only policy plus a successful fixture model turn and absent API-key environment are required for physical Spark acceptance."
  });
}

function defaultPaths() {
  const codexHome = process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), ".codex");
  return {
    userConfigPath: path.join(codexHome, "config.toml"),
    systemRequirementsPath: process.platform === "win32"
      ? path.join(process.env.ProgramData ?? "C:\\ProgramData", "OpenAI", "Codex", "requirements.toml")
      : "/etc/codex/requirements.toml",
  };
}

const directInvocation = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directInvocation) {
  const receipt = probeCodexChatgptAuthPolicy(defaultPaths());
  console.log(JSON.stringify(receipt, null, 2));
  process.exit(receipt.accepted ? 0 : 1);
}
