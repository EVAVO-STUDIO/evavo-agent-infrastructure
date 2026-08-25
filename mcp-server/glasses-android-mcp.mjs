import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

const REST_BASE = "http://127.0.0.1:4329";
const LOCAL_APP_DATA = (process.env.LOCALAPPDATA ?? "").trim();
const TARGET_REF = /^android-[a-f0-9]{16}$/u;
const CWD_ROOT = "gitrepos";
const CWD_RELATIVE = "evavo-glasses";
const BRIDGE_ROOT = "C:\\GitRepos\\evavo-android-device-bridge";
const CONFIRMATION = "TEST_EVAVO_GLASSES_ON_ANDROID_DEVICE";

const TOOLS = Object.freeze([
  {
    name: "evavo_glasses_android_doctor",
    description: "Inspect the checked-in GODMODE Android build/toolchain contract without building or touching an Android device.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "evavo_glasses_android_build",
    description: "Build and AAPT2-verify the current native GODMODE Android debug APK from the governed evavo-glasses checkout. Does not install it on a device.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "evavo_glasses_android_test_device",
    description: "Install/update the already built native GODMODE Android APK on one authorised private Android target, launch it and collect governed private evidence.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["targetRef"],
      properties: { targetRef: { type: "string", pattern: "^android-[a-f0-9]{16}$" } },
    },
  },
  {
    name: "evavo_glasses_android_build_and_test",
    description: "Run the clean-main GODMODE Android release check: build/unit-test/AAPT2 verification followed by install, launch, running-process verification and private evidence on one authorised target.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["targetRef"],
      properties: { targetRef: { type: "string", pattern: "^android-[a-f0-9]{16}$" } },
    },
  },
]);

function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("arguments must be an object");
  return value;
}

async function readJsonFile(file, min, max) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < min || stat.size > max) throw new Error("local credential projection failed file admission");
  return asObject(JSON.parse(await readFile(file, "utf8")));
}

async function loadOperatorToken() {
  if (!LOCAL_APP_DATA) throw new Error("LOCALAPPDATA is required");
  try {
    const doc = await readJsonFile(join(LOCAL_APP_DATA, "EVAVO", "LocalAgentRest043", "operator-token.json"), 32, 8192);
    const token = typeof doc.token === "string" ? doc.token.trim() : "";
    if (doc.schemaVersion === 1 && doc.kind === "evavo-local-agent-rest-operator-credential-v1" && doc.operatorExecEnabled === true && token.length >= 32) return { token, source: "same-user-operator-credential-projection" };
  } catch {}
  if ((process.env.EVAVO_LOCAL_AGENT_REST_OPERATOR_EXEC ?? "").trim() !== "1") throw new Error("Local Agent operator execution is not explicitly enabled");
  const token = (process.env.EVAVO_LOCAL_AGENT_REST_OPERATOR_TOKEN ?? "").trim();
  if (token.length < 32) throw new Error("Local Agent operator credential is unavailable");
  return { token, source: "process-environment" };
}

async function postOperator(command, timeoutSeconds) {
  const credential = await loadOperatorToken();
  let response;
  try {
    response = await fetch(`${REST_BASE}/v1/operator/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-EVAVO-Local-Agent-Token": credential.token },
      body: JSON.stringify({ commandType: "cmd", command, cwdRoot: CWD_ROOT, cwdRelative: CWD_RELATIVE, timeoutSeconds }),
      signal: AbortSignal.timeout((timeoutSeconds + 15) * 1000),
      cache: "no-store",
    });
  } catch {
    throw new Error("Local Agent GODMODE Android request did not return; execution outcome is unknown and was not retried");
  }
  let body;
  try { body = asObject(await response.json()); } catch { throw new Error("Local Agent REST returned invalid JSON"); }
  if (!response.ok) throw new Error(`Local Agent REST rejected GODMODE Android execution (${response.status})`);
  if (body.kind !== "evavo-local-agent-rest-operator-exec-v1" || body.operatorAuthority !== true || body.shellParameterUsed !== false) throw new Error("GODMODE Android operator receipt identity mismatch");
  if (body.ok !== true) throw new Error("GODMODE Android command failed on the workstation");
  let glasses;
  try { glasses = asObject(JSON.parse(String(body.stdout ?? "").trim())); } catch { throw new Error("GODMODE Android orchestrator returned invalid JSON"); }
  return {
    ...glasses,
    executor: {
      schema: "evavo.glasses-android-mcp-executor.v1",
      loopbackOnly: true,
      fixedCommandSurface: true,
      operatorCredentialSource: credential.source,
      credentialValuesReturned: false,
      physicalWorkstationPathReturned: false,
      commandTextAcceptedFromCaller: false,
      packageNameAcceptedFromCaller: false,
      apkPathAcceptedFromCaller: false,
    },
  };
}

function target(args) {
  const value = String(args.targetRef ?? "").trim();
  if (!TARGET_REF.test(value)) throw new Error("targetRef must be a privacy-safe Android target reference");
  return value;
}

async function callTool(name, raw) {
  const args = raw === undefined ? {} : asObject(raw);
  if (name === "evavo_glasses_android_doctor") {
    return postOperator(`powershell -NoProfile -ExecutionPolicy Bypass -File GODMODE-ANDROID.ps1 -Action Status -BridgeRoot ${BRIDGE_ROOT} -Json`, 120);
  }
  if (name === "evavo_glasses_android_build") {
    return postOperator(`powershell -NoProfile -ExecutionPolicy Bypass -File GODMODE-ANDROID.ps1 -Action Build -BridgeRoot ${BRIDGE_ROOT} -Json`, 300);
  }
  if (name === "evavo_glasses_android_test_device") {
    const ref = target(args);
    return postOperator(`powershell -NoProfile -ExecutionPolicy Bypass -File GODMODE-ANDROID.ps1 -Action TestDevice -BridgeRoot ${BRIDGE_ROOT} -Target ${ref} -Confirm ${CONFIRMATION} -Json`, 300);
  }
  if (name === "evavo_glasses_android_build_and_test") {
    const ref = target(args);
    return postOperator(`powershell -NoProfile -ExecutionPolicy Bypass -File GODMODE-ANDROID.ps1 -Action ReleaseCheck -BridgeRoot ${BRIDGE_ROOT} -Target ${ref} -Confirm ${CONFIRMATION} -RequireOriginMain -Json`, 300);
  }
  throw new Error(`unknown tool: ${name}`);
}

const result = (id, value) => ({ jsonrpc: "2.0", id: id ?? null, result: value });
const error = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

for await (const line of input) {
  if (!line.trim()) continue;
  let request;
  try { request = JSON.parse(line); } catch { write(error(null, -32700, "Parse error")); continue; }
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") { write(error(request.id, -32600, "Invalid request")); continue; }
  try {
    if (request.method === "notifications/initialized") continue;
    if (request.method === "ping") write(result(request.id, {}));
    else if (request.method === "initialize") write(result(request.id, { protocolVersion: "2024-11-05", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "evavo-glasses-android-mcp", version: "1.0.0" } }));
    else if (request.method === "tools/list") write(result(request.id, { tools: TOOLS }));
    else if (request.method === "tools/call") {
      const params = asObject(request.params);
      const value = await callTool(String(params.name ?? ""), params.arguments);
      write(result(request.id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError: false }));
    } else write(error(request.id, -32601, "Method not found"));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown error";
    write(result(request.id, { content: [{ type: "text", text: JSON.stringify({ ok: false, error: message, credentialValuesReturned: false, physicalPathsReturned: false }) }], isError: true }));
  }
}
