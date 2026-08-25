import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

const REST_BASE = "http://127.0.0.1:4329";
const LOCAL_APP_DATA = (process.env.LOCALAPPDATA ?? "").trim();
const TARGET_REF = /^android-[a-f0-9]{16}$/u;
const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u;
const JOURNEY = /^[A-Za-z0-9._-]+(?:[\\/][A-Za-z0-9._-]+)*\.json$/u;
const CWD_ROOT = "gitrepos";
const CWD_RELATIVE = "godot-game-test-lab";
const EXEC_TIMEOUT_SECONDS = 3300;

const TOOLS = Object.freeze([
  {
    name: "evavo_godot_android_physical_journey",
    description: "Build, install, launch and semantically play a debug Godot Android build on a verified physical owned device. Uses only target-declared InputMap actions, bounded project-owned state assertions and Android Bridge port/evidence authority; no raw coordinates or arbitrary ADB shell.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["targetRef", "repository", "packageName", "journey"],
      properties: {
        targetRef: { type: "string", pattern: "^android-[a-f0-9]{16}$" },
        repository: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$" },
        packageName: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z][A-Za-z0-9_]*)+$" },
        journey: { type: "string", pattern: "^[A-Za-z0-9._-]+(?:[\\\\/][A-Za-z0-9._-]+)*\\.json$" },
      },
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
    if (doc.schemaVersion === 1 && doc.kind === "evavo-local-agent-rest-operator-credential-v1" && doc.operatorExecEnabled === true && token.length >= 32) {
      return { token, source: "same-user-operator-credential-projection" };
    }
  } catch {}
  if ((process.env.EVAVO_LOCAL_AGENT_REST_OPERATOR_EXEC ?? "").trim() !== "1") throw new Error("Local Agent operator execution is not explicitly enabled");
  const token = (process.env.EVAVO_LOCAL_AGENT_REST_OPERATOR_TOKEN ?? "").trim();
  if (token.length < 32) throw new Error("Local Agent operator credential is unavailable");
  return { token, source: "process-environment" };
}

async function requireLongOperatorLane() {
  let response;
  try {
    response = await fetch(`${REST_BASE}/health`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
  } catch {
    throw new Error("Local Agent REST gateway is unavailable");
  }
  let health;
  try { health = asObject(await response.json()); } catch { throw new Error("Local Agent REST health returned invalid JSON"); }
  if (!response.ok || health.ok !== true || health.loopbackOnly !== true) throw new Error("Local Agent REST health admission failed");
  if (health.operatorTimeoutBounded !== true || Number(health.operatorTimeoutMaxSeconds) < EXEC_TIMEOUT_SECONDS) {
    throw new Error("Local Agent REST gateway 0.45 long operator lane is not active; install/activate the reviewed 0.45 gateway before physical Godot journeys");
  }
}

function validateArguments(raw) {
  const args = asObject(raw);
  const targetRef = String(args.targetRef ?? "").trim();
  const repository = String(args.repository ?? "").trim();
  const packageName = String(args.packageName ?? "").trim();
  const journey = String(args.journey ?? "").trim().replaceAll("/", "\\");
  if (!TARGET_REF.test(targetRef)) throw new Error("invalid targetRef");
  if (!REPO.test(repository)) throw new Error("repository must be one safe C:\\GitRepos repository name");
  if (!PACKAGE.test(packageName)) throw new Error("invalid packageName");
  if (!JOURNEY.test(journey) || journey.split("\\").includes("..")) throw new Error("journey must be a safe JSON path inside the selected repository");
  return { targetRef, repository, packageName, journey };
}

function sanitize(summary) {
  const { project: _project, journey: _journey, journeyResult: _journeyResult, ...safe } = asObject(summary);
  return {
    ...safe,
    physicalWorkstationPathsReturned: false,
    callerSuppliedCommandAccepted: false,
    arbitraryAdbShellAccepted: false,
    rawCoordinatesAccepted: false,
  };
}

async function postOperator(command) {
  await requireLongOperatorLane();
  const credential = await loadOperatorToken();
  let response;
  try {
    response = await fetch(`${REST_BASE}/v1/operator/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-EVAVO-Local-Agent-Token": credential.token },
      body: JSON.stringify({ commandType: "cmd", command, cwdRoot: CWD_ROOT, cwdRelative: CWD_RELATIVE, timeoutSeconds: EXEC_TIMEOUT_SECONDS }),
      signal: AbortSignal.timeout((EXEC_TIMEOUT_SECONDS + 30) * 1000),
      cache: "no-store",
    });
  } catch {
    throw new Error("Physical Godot Android journey did not return; outcome is unknown and was not retried");
  }
  let body;
  try { body = asObject(await response.json()); } catch { throw new Error("Local Agent REST returned invalid JSON"); }
  if (!response.ok || body.kind !== "evavo-local-agent-rest-operator-exec-v1" || body.operatorAuthority !== true || body.shellParameterUsed !== false || body.ok !== true) {
    throw new Error("Physical Godot Android operator execution failed or returned an invalid receipt");
  }
  let summary;
  try { summary = asObject(JSON.parse(String(body.stdout ?? "").trim())); } catch { throw new Error("Godot Game Test Lab returned invalid canonical JSON"); }
  if (summary.schema !== "evavo_godot_lab_android_journey_summary_v1" || summary.ok !== true || summary.deviceClass !== "physical" || summary.physicalDeviceRequired !== true || summary.physicalDeviceExecutionClaimed !== true || summary.semanticGameplayClaimed !== true) {
    throw new Error("Godot physical semantic journey truth contract mismatch");
  }
  if (summary.rawCoordinatesUsed !== false || summary.arbitraryAdbShellExposed !== false || summary.releaseBuildClaimed !== false || summary.portMappingRemoved !== true) {
    throw new Error("Godot physical semantic journey safety/cleanup contract mismatch");
  }
  return {
    ...sanitize(summary),
    executor: {
      schema: "evavo.godot-android-physical-mcp-executor.v1",
      loopbackOnly: true,
      fixedCommandSurface: true,
      longOperatorLaneRequired: true,
      operatorTimeoutSeconds: EXEC_TIMEOUT_SECONDS,
      operatorCredentialSource: credential.source,
      credentialValuesReturned: false,
      commandTextAcceptedFromCaller: false,
      physicalWorkstationPathsReturned: false,
    },
  };
}

async function callTool(name, raw) {
  if (name !== "evavo_godot_android_physical_journey") throw new Error(`unknown tool: ${name}`);
  const { targetRef, repository, packageName, journey } = validateArguments(raw);
  const project = `C:\\GitRepos\\${repository}`;
  const journeyPath = `${project}\\${journey}`;
  const command = `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\Invoke-GodotLabAndroidJourney.ps1 -Target ${targetRef} -Project "${project}" -Package ${packageName} -Journey "${journeyPath}" -Confirm TEST_GODOT_ANDROID_JOURNEY_ON_OWNED_DEVICE`;
  return postOperator(command);
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
    else if (request.method === "initialize") write(result(request.id, { protocolVersion: "2024-11-05", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "evavo-godot-android-physical-mcp", version: "1.0.0" } }));
    else if (request.method === "tools/list") write(result(request.id, { tools: TOOLS }));
    else if (request.method === "tools/call") {
      const params = asObject(request.params);
      const value = await callTool(String(params.name ?? ""), params.arguments);
      write(result(request.id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError: false }));
    } else write(error(request.id, -32601, "Method not found"));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown error";
    write(result(request.id, { content: [{ type: "text", text: JSON.stringify({ ok: false, error: message, credentialValuesReturned: false, physicalPathsReturned: false, arbitraryCommandAccepted: false }) }], isError: true }));
  }
}
