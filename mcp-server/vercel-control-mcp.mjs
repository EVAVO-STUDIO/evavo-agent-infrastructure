import { existsSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";

const DEFAULT_DEV_STUDIO = "C:\\GitRepos\\evavo-development-studio";
const DEVELOPMENT_STUDIO = resolve((process.env.EVAVO_DEVELOPMENT_STUDIO_REPO ?? DEFAULT_DEV_STUDIO).trim());
const CONTROL = join(DEVELOPMENT_STUDIO, "scripts", "vercel-control.mjs");
const POLICY = join(DEVELOPMENT_STUDIO, "config", "vercel-control-policy.json");
const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_TIMEOUT_MS = 12 * 60 * 1000;

const TOOLS = Object.freeze([
  {
    name: "evavo_vercel_control_capabilities",
    description: "Inspect EVAVO's full Vercel control bridge readiness without returning credential values. Reports the Development Studio control surface, token presence, Vercel CLI availability and supported effect classes.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "evavo_vercel_control",
    description: "Plan or execute one governed Vercel operation through Development Studio. Covers projects, env vars, custom environments, deployments, aliases, custom domains, external-registrar DNS plans, Vercel-hosted DNS and constrained raw Vercel REST calls. Mutations require execute=true and Development Studio still enforces reason/destructive guards, secret-by-environment references and provider read-back.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request"],
      properties: {
        request: { type: "object", minProperties: 1, maxProperties: 100 },
        execute: { type: "boolean" },
        strict: { type: "boolean" },
        timeoutSeconds: { type: "integer", minimum: 1, maximum: 720 },
      },
    },
  },
]);

function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("arguments must be an object");
  return value;
}

function safeRegularFile(file) {
  if (!existsSync(file)) return false;
  const stats = lstatSync(file);
  return stats.isFile() && !stats.isSymbolicLink();
}

function commandAvailable(command) {
  const envPath = process.env.PATH ?? "";
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const root of envPath.split(process.platform === "win32" ? ";" : ":").filter(Boolean)) {
    for (const extension of extensions) {
      try {
        if (safeRegularFile(join(root, `${command}${extension}`))) return true;
      } catch {}
    }
  }
  return false;
}

function boundedJson(value) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, "utf8") > MAX_REQUEST_BYTES) throw new Error("Vercel control request exceeds the MCP bound");
  return text;
}

function credentialProjection() {
  const direct = Boolean((process.env.VERCEL_TOKEN ?? "").trim() || (process.env.VERCEL_API_TOKEN ?? "").trim());
  const siblingEnv = resolve(DEVELOPMENT_STUDIO, "..", "evavo-github-mcp", ".env");
  const candidates = [
    join(DEVELOPMENT_STUDIO, ".env.local"),
    join(DEVELOPMENT_STUDIO, ".env"),
    siblingEnv,
    ...(process.platform === "win32" ? ["C:\\GitRepos\\evavo-github-mcp\\.env"] : []),
  ];
  const localCredentialFilePresent = candidates.some((candidate) => {
    try { return safeRegularFile(candidate); } catch { return false; }
  });
  return {
    processCredentialPresent: direct,
    localCredentialFilePresent,
    acceptedEnvironmentKeys: ["VERCEL_TOKEN", "VERCEL_API_TOKEN"],
    credentialValuesReturned: false,
  };
}

async function capabilities() {
  return {
    schemaVersion: 1,
    kind: "evavo-vercel-control-mcp-capabilities-v1",
    ok: safeRegularFile(CONTROL) && safeRegularFile(POLICY),
    authorityRepository: "EVAVO-STUDIO/evavo-development-studio",
    routingRepository: "EVAVO-STUDIO/evavo-agent-infrastructure",
    controlScriptPresent: safeRegularFile(CONTROL),
    policyPresent: safeRegularFile(POLICY),
    nodePresent: commandAvailable("node"),
    vercelCliPresent: commandAvailable("vercel"),
    credentials: credentialProjection(),
    operations: [
      "project.list", "project.get", "project.create", "project.update", "project.delete",
      "env.list", "env.set", "env.delete", "custom-environment.create", "custom-environment.delete",
      "deployment.list", "deployment.get", "deployment.deploy", "deployment.redeploy", "deployment.promote",
      "deployment.rollback", "deployment.cancel", "deployment.delete", "alias.assign",
      "domain.list", "domain.get", "domain.add", "domain.update", "domain.verify", "domain.remove",
      "domain.config", "domain.dns-plan", "dns.list", "dns.create", "dns.update", "dns.delete", "api.call",
    ],
    secretPolicy: "environment-reference-only",
    writePolicy: "explicit execute plus reason; destructive operations also require allowDestructive",
    verificationPolicy: "provider read-back after supported writes; no blind write retries",
    backgroundProviderMutation: false,
    credentialValuesReturned: false,
    arbitraryShellAccepted: false,
  };
}

function runControl(request, execute, strict, timeoutSeconds) {
  if (!safeRegularFile(CONTROL) || !safeRegularFile(POLICY)) {
    throw new Error("Development Studio Vercel Control is not installed at the admitted repository path");
  }
  const payload = boundedJson(request);
  const args = [CONTROL, "--request", "-", "--json"];
  if (execute === true) args.push("--execute");
  if (strict !== false) args.push("--strict");
  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Number(timeoutSeconds ?? 300) * 1000));

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, args, {
      cwd: DEVELOPMENT_STUDIO,
      env: { ...process.env, EVAVO_VERCEL_MCP: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectPromise(error); else resolvePromise(value);
    };
    const append = (current, chunk) => {
      const next = Buffer.concat([current, Buffer.from(chunk)]);
      if (next.length > MAX_OUTPUT_BYTES) {
        child.kill();
        throw new Error("Vercel control output exceeded the MCP bound");
      }
      return next;
    };
    child.stdout.on("data", (chunk) => {
      try { stdout = append(stdout, chunk); } catch (error) { finish(error); }
    });
    child.stderr.on("data", (chunk) => {
      try { stderr = append(stderr, chunk); } catch (error) { finish(error); }
    });
    child.on("error", (error) => finish(new Error(`Vercel control process failed to start: ${error.message}`)));
    child.on("close", (code) => {
      if (settled) return;
      const errorText = stderr.toString("utf8").trim().slice(0, 4_000);
      if (code !== 0) return finish(new Error(`Vercel control failed (${code}): ${errorText || "unknown error"}`));
      const text = stdout.toString("utf8").trim();
      let document;
      try { document = JSON.parse(text); } catch { return finish(new Error("Vercel control returned invalid JSON")); }
      finish(null, { ...document, credentialValuesReturned: false, mcpBridge: "evavo-vercel-control-v1" });
    });
    child.stdin.end(`${payload}\n`, "utf8");
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Vercel control timed out; execution outcome may be unknown and was not retried"));
    }, timeoutMs);
  });
}

async function callTool(name, raw) {
  const args = raw === undefined ? {} : asObject(raw);
  if (name === "evavo_vercel_control_capabilities") return capabilities();
  if (name === "evavo_vercel_control") {
    const request = asObject(args.request);
    const timeoutSeconds = args.timeoutSeconds === undefined ? 300 : Number(args.timeoutSeconds);
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 720) throw new Error("timeoutSeconds is invalid");
    return runControl(request, args.execute === true, args.strict !== false, timeoutSeconds);
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
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    write(error(request.id, -32600, "Invalid request"));
    continue;
  }
  try {
    if (request.method === "notifications/initialized") continue;
    if (request.method === "ping") write(result(request.id, {}));
    else if (request.method === "initialize") write(result(request.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "evavo-vercel-control-mcp", version: "1.0.0" },
    }));
    else if (request.method === "tools/list") write(result(request.id, { tools: TOOLS }));
    else if (request.method === "tools/call") {
      const params = asObject(request.params);
      const value = await callTool(String(params.name ?? ""), params.arguments);
      write(result(request.id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError: false }));
    } else write(error(request.id, -32601, "Method not found"));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown error";
    write(result(request.id, {
      content: [{ type: "text", text: JSON.stringify({ ok: false, error: message, credentialValuesReturned: false }) }],
      isError: true,
    }));
  }
}
