import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

interface Env {
  VERCEL_TOKEN: string;
  VERCEL_TEAM_ID: string;
  CONTROL_TOKEN: string;
}

type JsonObject = Record<string, unknown>;

const API = "https://api.vercel.com";
const MAX_BODY_BYTES = 256 * 1024;
const WRITE_OPERATIONS = new Set([
  "project.create", "project.update", "project.ensure", "deployment.deploy",
  "domain.add", "domain.update", "domain.ensure", "domain.verify", "domain.remove",
]);
const DESTRUCTIVE_OPERATIONS = new Set(["domain.remove"]);
const OPERATIONS = new Set([
  "project.list", "project.get", "project.create", "project.update", "project.ensure",
  "deployment.list", "deployment.get", "deployment.deploy",
  "domain.list", "domain.get", "domain.add", "domain.update", "domain.ensure", "domain.verify", "domain.remove",
  "domain.config", "domain.dns-plan",
]);

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("request-object-required");
  return value as JsonObject;
}
function optionalObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
function text(value: unknown, name: string, max = 500): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${name}-invalid`);
  return value;
}
function project(value: unknown): string {
  const result = text(value, "project", 100);
  if (!/^(?:prj_[A-Za-z0-9]+|[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?)$/u.test(result)) throw new Error("project-invalid");
  return result;
}
function projectName(value: unknown): string {
  const result = project(value);
  if (result.startsWith("prj_")) throw new Error("project-name-required");
  return result;
}
function domain(value: unknown): string {
  const result = text(value, "domain", 253).toLowerCase().replace(/\.$/u, "");
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(result)) throw new Error("domain-invalid");
  return result;
}
function repository(value: unknown): { org: string; repo: string; full: string } {
  const full = text(value, "repository", 180);
  const match = /^(EVAVO-STUDIO)\/([A-Za-z0-9._-]{1,100})$/u.exec(full);
  if (!match) throw new Error("repository-not-evavo");
  return { org: match[1], repo: match[2], full };
}
function reason(request: JsonObject): string {
  return text(request.reason, "reason", 500);
}
function encode(value: string): string { return encodeURIComponent(value); }
function teamUrl(path: string, env: Env): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${API}${path}${separator}teamId=${encodeURIComponent(env.VERCEL_TEAM_ID)}`;
}
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const out: JsonObject = {};
  for (const [key, entry] of Object.entries(value as JsonObject)) {
    out[key] = /token|secret|password|private.?key|api.?key/i.test(key) ? "[redacted]" : redact(entry);
  }
  return out;
}
async function provider(env: Env, method: string, path: string, body?: JsonObject): Promise<JsonObject> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(teamUrl(path, env), {
      method,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${env.VERCEL_TOKEN}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > 4 * 1024 * 1024) throw new Error("provider-response-too-large");
    let data: unknown = {};
    if (raw) {
      try { data = JSON.parse(raw); } catch { data = { message: raw.slice(0, 1000) }; }
    }
    if (!response.ok) {
      const safe = JSON.stringify(redact(data)).slice(0, 2000);
      throw new Error(`provider-${response.status}:${safe}`);
    }
    return object(data);
  } finally {
    clearTimeout(timer);
  }
}
async function providerOptionalGet(env: Env, path: string): Promise<JsonObject | null> {
  try { return await provider(env, "GET", path); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("provider-404:")) return null;
    throw error;
  }
}
function cleanSettings(value: unknown): JsonObject {
  if (value === undefined) return {};
  const settings = object(value);
  const allowed = new Set([
    "buildCommand", "commandForIgnoringBuildStep", "devCommand", "installCommand", "outputDirectory",
    "rootDirectory", "framework", "enablePreviewFeedback", "enableProductionFeedback",
    "previewDeploymentsDisabled", "serverlessFunctionRegion", "enableAffectedProjectsDeployments",
  ]);
  for (const key of Object.keys(settings)) if (!allowed.has(key)) throw new Error(`project-setting-not-admitted:${key}`);
  return settings;
}
function query(value: unknown): URLSearchParams {
  const result = new URLSearchParams();
  if (value === undefined) return result;
  for (const [key, entry] of Object.entries(object(value))) {
    if (!/^[A-Za-z0-9_.-]{1,80}$/u.test(key) || !["string", "number", "boolean"].includes(typeof entry)) throw new Error("query-invalid");
    result.set(key, String(entry));
  }
  return result;
}
function gitRepositoryFromRequest(value: unknown): { body?: JsonObject; desired?: { org: string; repo: string } } {
  if (value === undefined) return {};
  const git = object(value);
  if (git.type !== "github") throw new Error("git-provider-not-admitted");
  const repo = repository(git.repo);
  return { body: { type: "github", repo: repo.full }, desired: { org: repo.org, repo: repo.repo } };
}
function projectSettingsDelta(observed: JsonObject, desired: JsonObject): JsonObject {
  const delta: JsonObject = {};
  for (const [key, value] of Object.entries(desired)) if (observed[key] !== value) delta[key] = value;
  return delta;
}
function projectGitMatches(observed: JsonObject, desired?: { org: string; repo: string }): boolean {
  if (!desired) return true;
  const link = optionalObject(observed.link);
  return Boolean(link && link.type === "github" && link.org === desired.org && link.repo === desired.repo);
}
function domainMutationBody(request: JsonObject, includeName: boolean): JsonObject {
  const body: JsonObject = {};
  if (includeName) body.name = domain(request.domain);
  if (request.gitBranch !== undefined) body.gitBranch = request.gitBranch === null ? null : text(request.gitBranch, "gitBranch", 250);
  if (request.redirect !== undefined) body.redirect = request.redirect === null ? null : domain(request.redirect);
  if (request.redirectStatusCode !== undefined) {
    const code = Number(request.redirectStatusCode);
    if (![301,302,307,308].includes(code)) throw new Error("redirect-status-invalid");
    body.redirectStatusCode = code;
  }
  return body;
}
function domainDelta(observed: JsonObject, desired: JsonObject): JsonObject {
  const delta: JsonObject = {};
  for (const key of ["gitBranch", "redirect", "redirectStatusCode"]) {
    if (Object.prototype.hasOwnProperty.call(desired, key) && observed[key] !== desired[key]) delta[key] = desired[key];
  }
  return delta;
}
function assertDomainDesired(observed: JsonObject, desired: JsonObject): void {
  const delta = domainDelta(observed, desired);
  if (Object.keys(delta).length) throw new Error(`domain-readback-mismatch:${Object.keys(delta).join(",")}`);
}

async function execute(env: Env, input: unknown, allowWrite: boolean): Promise<JsonObject> {
  const request = object(input);
  const operation = text(request.operation, "operation", 80);
  if (!OPERATIONS.has(operation)) throw new Error("operation-not-admitted");
  const write = WRITE_OPERATIONS.has(operation);
  if (write) {
    reason(request);
    if (!allowWrite) return { ok: true, status: "planned", executed: false, operation, write: true };
  }
  if (DESTRUCTIVE_OPERATIONS.has(operation) && request.allowDestructive !== true) throw new Error("allow-destructive-required");

  let data: JsonObject;
  switch (operation) {
    case "project.list": {
      const q = query(request.query); data = await provider(env, "GET", `/v9/projects${q.size ? `?${q}` : ""}`); break;
    }
    case "project.get": data = await provider(env, "GET", `/v9/projects/${encode(project(request.project))}`); break;
    case "project.create": {
      const name = projectName(request.project);
      const settings = cleanSettings(request.settings);
      const git = gitRepositoryFromRequest(request.gitRepository);
      data = await provider(env, "POST", "/v11/projects", { name, ...settings, ...(git.body ? { gitRepository: git.body } : {}) });
      break;
    }
    case "project.update": data = await provider(env, "PATCH", `/v9/projects/${encode(project(request.project))}`, cleanSettings(request.settings)); break;
    case "project.ensure": {
      const name = projectName(request.project);
      const settings = cleanSettings(request.settings);
      const git = gitRepositoryFromRequest(request.gitRepository);
      let observed = await providerOptionalGet(env, `/v9/projects/${encode(name)}`);
      let state = "present";
      if (!observed) {
        await provider(env, "POST", "/v11/projects", { name, ...settings, ...(git.body ? { gitRepository: git.body } : {}) });
        state = "created";
        observed = await provider(env, "GET", `/v9/projects/${encode(name)}`);
      } else {
        if (!projectGitMatches(observed, git.desired)) throw new Error("project-git-link-mismatch");
        const delta = projectSettingsDelta(observed, settings);
        if (Object.keys(delta).length) {
          await provider(env, "PATCH", `/v9/projects/${encode(name)}`, delta);
          state = "updated";
          observed = await provider(env, "GET", `/v9/projects/${encode(name)}`);
        }
      }
      if (!projectGitMatches(observed, git.desired)) throw new Error("project-git-link-readback-mismatch");
      const remaining = projectSettingsDelta(observed, settings);
      if (Object.keys(remaining).length) throw new Error(`project-settings-readback-mismatch:${Object.keys(remaining).join(",")}`);
      data = { state, project: redact(observed), desiredGitRepository: git.desired ? `${git.desired.org}/${git.desired.repo}` : null };
      break;
    }
    case "deployment.list": {
      const q = query(request.query); q.set("projectId", project(request.project)); data = await provider(env, "GET", `/v6/deployments?${q}`); break;
    }
    case "deployment.get": data = await provider(env, "GET", `/v13/deployments/${encode(text(request.deployment, "deployment", 240))}`); break;
    case "deployment.deploy": {
      const name = project(request.project);
      const repo = repository(request.repository);
      const ref = request.ref === undefined ? "main" : text(request.ref, "ref", 250);
      const target = request.production === false ? undefined : "production";
      data = await provider(env, "POST", "/v13/deployments", {
        name,
        project: name,
        gitSource: { type: "github", org: repo.org, repo: repo.repo, ref },
        ...(target ? { target } : {}),
      });
      break;
    }
    case "domain.list": {
      const q = query(request.query); data = await provider(env, "GET", `/v9/projects/${encode(project(request.project))}/domains${q.size ? `?${q}` : ""}`); break;
    }
    case "domain.get": data = await provider(env, "GET", `/v9/projects/${encode(project(request.project))}/domains/${encode(domain(request.domain))}`); break;
    case "domain.add": data = await provider(env, "POST", `/v10/projects/${encode(project(request.project))}/domains`, domainMutationBody(request, true)); break;
    case "domain.update": data = await provider(env, "PATCH", `/v9/projects/${encode(project(request.project))}/domains/${encode(domain(request.domain))}`, domainMutationBody(request, false)); break;
    case "domain.ensure": {
      const projectId = project(request.project);
      const hostname = domain(request.domain);
      const desired = domainMutationBody(request, true);
      let observed = await providerOptionalGet(env, `/v9/projects/${encode(projectId)}/domains/${encode(hostname)}`);
      let state = "present";
      if (!observed) {
        await provider(env, "POST", `/v10/projects/${encode(projectId)}/domains`, desired);
        state = "created";
        observed = await provider(env, "GET", `/v9/projects/${encode(projectId)}/domains/${encode(hostname)}`);
      } else {
        const delta = domainDelta(observed, desired);
        if (Object.keys(delta).length) {
          await provider(env, "PATCH", `/v9/projects/${encode(projectId)}/domains/${encode(hostname)}`, delta);
          state = "updated";
          observed = await provider(env, "GET", `/v9/projects/${encode(projectId)}/domains/${encode(hostname)}`);
        }
      }
      assertDomainDesired(observed, desired);
      data = { state, domain: redact(observed) };
      break;
    }
    case "domain.verify": data = await provider(env, "POST", `/v9/projects/${encode(project(request.project))}/domains/${encode(domain(request.domain))}/verify`, {}); break;
    case "domain.remove": data = await provider(env, "DELETE", `/v9/projects/${encode(project(request.project))}/domains/${encode(domain(request.domain))}`); break;
    case "domain.config": data = await provider(env, "GET", `/v6/domains/${encode(domain(request.domain))}/config`); break;
    case "domain.dns-plan": {
      const projectName = project(request.project); const hostname = domain(request.domain);
      const domainData = await provider(env, "GET", `/v9/projects/${encode(projectName)}/domains/${encode(hostname)}`);
      const apex = typeof domainData.apexName === "string" ? domainData.apexName : hostname;
      const config = await provider(env, "GET", `/v6/domains/${encode(apex)}/config`);
      data = {
        domain: hostname,
        project: projectName,
        apexName: apex,
        verified: domainData.verified === true,
        verification: redact(domainData.verification ?? []),
        misconfigured: config.misconfigured === true,
        configuredBy: config.configuredBy ?? null,
        recommendedIPv4: redact(config.recommendedIPv4 ?? []),
        recommendedCNAME: redact(config.recommendedCNAME ?? []),
      };
      break;
    }
    default: throw new Error("operation-not-implemented");
  }
  return { ok: true, status: "completed", executed: true, operation, write, provider: redact(data), credentialValuesReturned: false };
}
function bearer(request: Request): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? ""); return match?.[1] ?? null;
}
function same(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false; let diff = 0; for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i); return diff === 0;
}
function makeServer(env: Env): McpServer {
  const server = new McpServer({ name: "EVAVO Vercel Provider Control", version: "1.1.0" });
  server.registerTool("evavo_vercel_provider_probe", {
    description: "Prove cloud-side EVAVO Vercel provider authentication without workstation dependency or credential disclosure.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => {
    const result = await provider(env, "GET", "/v9/projects?limit=1");
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, authenticated: true, workstationRequired: false, projectSurfaceReadable: Array.isArray(result.projects), credentialValuesReturned: false }) }] };
  });
  server.registerTool("evavo_vercel_provider_control", {
    description: "Plan or execute governed cloud-side Vercel project, Git deployment, and custom-domain operations. Prefer project.ensure and domain.ensure for retry-safe desired-state convergence. Writes require execute=true plus a reason; destructive operations additionally require allowDestructive=true.",
    inputSchema: { request: z.record(z.string(), z.unknown()), execute: z.boolean().optional() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async ({ request, execute: allowWrite }) => ({ content: [{ type: "text", text: JSON.stringify(await execute(env, request, allowWrite === true)) }] }));
  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return new Response(JSON.stringify({ ok: true, service: "evavo-vercel-provider-relay", version: "1.1.0", workstationRequired: false, providerCredentialConfigured: Boolean(env.VERCEL_TOKEN), controlCredentialConfigured: Boolean(env.CONTROL_TOKEN), desiredStateOperations: ["project.ensure", "domain.ensure"], credentialValuesReturned: false }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    if (url.pathname === "/mcp") {
      const supplied = bearer(request);
      if (!supplied || !same(supplied, env.CONTROL_TOKEN)) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
      return createMcpHandler(() => makeServer(env), { route: "/mcp", responseMode: "json", legacy: "stateless" })(request, env, ctx);
    }
    if (url.pathname === "/api/control" && request.method === "POST") {
      const supplied = bearer(request);
      if (!supplied || !same(supplied, env.CONTROL_TOKEN)) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return new Response(JSON.stringify({ ok: false, error: "body-too-large" }), { status: 413, headers: { "content-type": "application/json" } });
      try {
        const body = object(JSON.parse(raw));
        const result = await execute(env, body.request, body.execute === true);
        return new Response(JSON.stringify(result), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      } catch (error) {
        return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message.slice(0, 2000) : "control-failed", credentialValuesReturned: false }), { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      }
    }
    return new Response("Not Found", { status: 404 });
  },
};
