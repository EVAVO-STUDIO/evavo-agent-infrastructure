import providerWorker from "./worker";

type JsonObject = Record<string, unknown>;

interface Env {
  VERCEL_TOKEN: string;
  VERCEL_TEAM_ID: string;
  CONTROL_TOKEN: string;
  GITHUB_TOKEN: string;
}

interface DesiredDomain {
  name: string;
  redirect?: string;
  redirectStatusCode?: 301 | 302 | 307 | 308;
}

interface DesiredProject {
  name: string;
  repository: string;
  rootDirectory: string;
  productionBranch: string;
  deployIfMissing: boolean;
  domains: DesiredDomain[];
}

interface DesiredState {
  schemaVersion: 1;
  kind: "evavo-vercel-provider-desired-state-v1";
  enabled: boolean;
  projects: DesiredProject[];
}

const GITHUB_API = "https://api.github.com";
const VERCEL_API = "https://api.vercel.com";
const DESIRED_STATE_REPOSITORY = "EVAVO-STUDIO/evavo-agent-infrastructure";
const DESIRED_STATE_PATH = "config/vercel-provider-desired-state-v1.json";
const MAX_GITHUB_BODY_BYTES = 512 * 1024;
const MAX_PROJECTS = 20;
const MAX_DOMAINS_PER_PROJECT = 20;
const READY_DEPLOYMENT_STATES = new Set(["READY", "BUILDING", "QUEUED", "INITIALIZING"]);

function object(value: unknown, code = "object-required"): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonObject;
}

function text(value: unknown, code: string, max = 500): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(code);
  }
  return value;
}

function projectName(value: unknown): string {
  const result = text(value, "desired-project-name-invalid", 100);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u.test(result)) throw new Error("desired-project-name-invalid");
  return result;
}

function repository(value: unknown): string {
  const result = text(value, "desired-repository-invalid", 180);
  if (!/^EVAVO-STUDIO\/[A-Za-z0-9._-]{1,100}$/u.test(result)) throw new Error("desired-repository-not-evavo");
  return result;
}

function rootDirectory(value: unknown): string {
  const result = text(value, "desired-root-directory-invalid", 300).replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
  if (!result || result.includes("..") || result.startsWith(".")) throw new Error("desired-root-directory-invalid");
  return result;
}

function branch(value: unknown): string {
  const result = text(value, "desired-production-branch-invalid", 200);
  if (!/^[A-Za-z0-9._/-]+$/u.test(result) || result.includes("..") || result.startsWith("/") || result.endsWith("/")) {
    throw new Error("desired-production-branch-invalid");
  }
  return result;
}

function domain(value: unknown): string {
  const result = text(value, "desired-domain-invalid", 253).toLowerCase().replace(/\.$/u, "");
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(result)) {
    throw new Error("desired-domain-invalid");
  }
  return result;
}

function desiredState(value: unknown): DesiredState {
  const raw = object(value, "desired-state-object-required");
  if (raw.schemaVersion !== 1 || raw.kind !== "evavo-vercel-provider-desired-state-v1") throw new Error("desired-state-contract-invalid");
  if (raw.enabled !== true && raw.enabled !== false) throw new Error("desired-state-enabled-invalid");
  if (!Array.isArray(raw.projects) || raw.projects.length > MAX_PROJECTS) throw new Error("desired-state-projects-invalid");

  const names = new Set<string>();
  const projects: DesiredProject[] = raw.projects.map((entry) => {
    const item = object(entry, "desired-project-object-required");
    const name = projectName(item.name);
    if (names.has(name)) throw new Error("desired-project-duplicate");
    names.add(name);
    const repo = repository(item.repository);
    const root = rootDirectory(item.rootDirectory);
    const productionBranch = branch(item.productionBranch ?? "main");
    const deployIfMissing = item.deployIfMissing !== false;
    if (!Array.isArray(item.domains) || item.domains.length > MAX_DOMAINS_PER_PROJECT) throw new Error("desired-domains-invalid");
    const domainNames = new Set<string>();
    const domains = item.domains.map((rawDomain): DesiredDomain => {
      const row = object(rawDomain, "desired-domain-object-required");
      const nameValue = domain(row.name);
      if (domainNames.has(nameValue)) throw new Error("desired-domain-duplicate");
      domainNames.add(nameValue);
      const result: DesiredDomain = { name: nameValue };
      if (row.redirect !== undefined && row.redirect !== null) result.redirect = domain(row.redirect);
      if (row.redirectStatusCode !== undefined) {
        const code = Number(row.redirectStatusCode);
        if (![301, 302, 307, 308].includes(code)) throw new Error("desired-domain-redirect-status-invalid");
        result.redirectStatusCode = code as 301 | 302 | 307 | 308;
      }
      return result;
    });
    return { name, repository: repo, rootDirectory: root, productionBranch, deployIfMissing, domains };
  });
  return { schemaVersion: 1, kind: "evavo-vercel-provider-desired-state-v1", enabled: raw.enabled as boolean, projects };
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const output: JsonObject = {};
  for (const [key, entry] of Object.entries(value as JsonObject)) {
    output[key] = /token|secret|password|private.?key|api.?key/i.test(key) ? "[redacted]" : redact(entry);
  }
  return output;
}

async function boundedJson(response: Response, code: string): Promise<JsonObject> {
  const raw = await response.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_GITHUB_BODY_BYTES) throw new Error(`${code}-too-large`);
  let parsed: unknown;
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`${code}-invalid-json`); }
  if (!response.ok) throw new Error(`${code}-${response.status}:${JSON.stringify(redact(parsed)).slice(0, 1200)}`);
  return object(parsed, `${code}-object-required`);
}

async function github(env: Env, path: string): Promise<JsonObject> {
  if (!env.GITHUB_TOKEN) throw new Error("github-read-token-missing");
  const response = await fetch(`${GITHUB_API}${path}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "EVAVO-Vercel-Provider-Relay/1.2",
    },
  });
  return boundedJson(response, "github-read-failed");
}

function decodeBase64(value: unknown): string {
  const raw = text(value, "github-content-invalid", MAX_GITHUB_BODY_BYTES).replace(/\s+/gu, "");
  try {
    const bytes = Uint8Array.from(atob(raw), (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("github-content-decode-failed");
  }
}

async function loadDesiredState(env: Env): Promise<{ revision: string; state: DesiredState }> {
  const commit = await github(env, `/repos/${DESIRED_STATE_REPOSITORY}/commits/main`);
  const revision = text(commit.sha, "github-main-revision-invalid", 40).toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(revision)) throw new Error("github-main-revision-invalid");
  const encodedPath = DESIRED_STATE_PATH.split("/").map(encodeURIComponent).join("/");
  const content = await github(env, `/repos/${DESIRED_STATE_REPOSITORY}/contents/${encodedPath}?ref=${revision}`);
  if (content.type !== "file" || content.encoding !== "base64") throw new Error("github-desired-state-file-invalid");
  let parsed: unknown;
  try { parsed = JSON.parse(decodeBase64(content.content)); } catch (error) {
    if (error instanceof Error && error.message.startsWith("github-content-")) throw error;
    throw new Error("desired-state-json-invalid");
  }
  return { revision, state: desiredState(parsed) };
}

async function vercel(env: Env, method: string, path: string, body?: JsonObject): Promise<JsonObject> {
  if (!env.VERCEL_TOKEN || !env.VERCEL_TEAM_ID) throw new Error("vercel-provider-credential-missing");
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${VERCEL_API}${path}${separator}teamId=${encodeURIComponent(env.VERCEL_TEAM_ID)}`, {
    method,
    headers: { authorization: `Bearer ${env.VERCEL_TOKEN}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let parsed: unknown = {};
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { parsed = { message: raw.slice(0, 1000) }; }
  }
  if (!response.ok) throw new Error(`vercel-provider-${response.status}:${JSON.stringify(redact(parsed)).slice(0, 1500)}`);
  return object(parsed, "vercel-provider-response-invalid");
}

async function vercelOptionalGet(env: Env, path: string): Promise<JsonObject | null> {
  try { return await vercel(env, "GET", path); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("vercel-provider-404:")) return null;
    throw error;
  }
}

function repoParts(full: string): { org: string; repo: string } {
  const [org, repo] = full.split("/", 2);
  return { org, repo };
}

function gitMatches(project: JsonObject, fullRepository: string): boolean {
  const link = project.link;
  if (!link || typeof link !== "object" || Array.isArray(link)) return false;
  const value = link as JsonObject;
  const expected = repoParts(fullRepository);
  return value.type === "github" && String(value.org ?? "").casefold?.() === undefined
    ? false
    : String(value.type ?? "").toLowerCase() === "github"
      && String(value.org ?? "").toLowerCase() === expected.org.toLowerCase()
      && String(value.repo ?? "").toLowerCase() === expected.repo.toLowerCase();
}

async function ensureProject(env: Env, desired: DesiredProject): Promise<{ state: string; project: JsonObject }> {
  let observed = await vercelOptionalGet(env, `/v9/projects/${encodeURIComponent(desired.name)}`);
  let state = "present";
  const git = repoParts(desired.repository);
  if (!observed) {
    await vercel(env, "POST", "/v11/projects", {
      name: desired.name,
      rootDirectory: desired.rootDirectory,
      gitRepository: { type: "github", repo: desired.repository },
    });
    state = "created";
    observed = await vercel(env, "GET", `/v9/projects/${encodeURIComponent(desired.name)}`);
  } else {
    if (!gitMatches(observed, desired.repository)) throw new Error(`project-git-link-mismatch:${desired.name}`);
    const currentRoot = String(observed.rootDirectory ?? "").replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
    if (currentRoot !== desired.rootDirectory) {
      await vercel(env, "PATCH", `/v9/projects/${encodeURIComponent(desired.name)}`, { rootDirectory: desired.rootDirectory });
      state = "updated";
      observed = await vercel(env, "GET", `/v9/projects/${encodeURIComponent(desired.name)}`);
    }
  }
  if (!gitMatches(observed, desired.repository)) throw new Error(`project-git-link-readback-mismatch:${desired.name}`);
  const readRoot = String(observed.rootDirectory ?? "").replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
  if (readRoot !== desired.rootDirectory) throw new Error(`project-root-readback-mismatch:${desired.name}`);
  if (String((observed.link as JsonObject | undefined)?.repo ?? "").toLowerCase() !== git.repo.toLowerCase()) throw new Error(`project-repository-readback-mismatch:${desired.name}`);
  return { state, project: observed };
}

async function ensureDeployment(env: Env, desired: DesiredProject): Promise<{ state: string; deployment?: JsonObject }> {
  const query = new URLSearchParams({ projectId: desired.name, target: "production", limit: "5" });
  const listed = await vercel(env, "GET", `/v6/deployments?${query.toString()}`);
  const deployments = Array.isArray(listed.deployments) ? listed.deployments.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) as JsonObject[] : [];
  const current = deployments.find((entry) => READY_DEPLOYMENT_STATES.has(String(entry.state ?? entry.readyState ?? "").toUpperCase()));
  if (current || !desired.deployIfMissing) return { state: current ? "present" : "not-required", ...(current ? { deployment: current } : {}) };
  const repo = repoParts(desired.repository);
  const deployment = await vercel(env, "POST", "/v13/deployments", {
    name: desired.name,
    project: desired.name,
    gitSource: { type: "github", org: repo.org, repo: repo.repo, ref: desired.productionBranch },
    target: "production",
  });
  return { state: "created", deployment };
}

function domainDelta(observed: JsonObject, desired: DesiredDomain): JsonObject {
  const delta: JsonObject = {};
  if (desired.redirect !== undefined && observed.redirect !== desired.redirect) delta.redirect = desired.redirect;
  if (desired.redirectStatusCode !== undefined && Number(observed.redirectStatusCode) !== desired.redirectStatusCode) delta.redirectStatusCode = desired.redirectStatusCode;
  return delta;
}

async function ensureDomain(env: Env, project: string, desired: DesiredDomain): Promise<{ state: string; domain: JsonObject }> {
  const projectId = encodeURIComponent(project);
  const hostname = encodeURIComponent(desired.name);
  let observed = await vercelOptionalGet(env, `/v9/projects/${projectId}/domains/${hostname}`);
  let state = "present";
  if (!observed) {
    const body: JsonObject = { name: desired.name };
    if (desired.redirect !== undefined) body.redirect = desired.redirect;
    if (desired.redirectStatusCode !== undefined) body.redirectStatusCode = desired.redirectStatusCode;
    await vercel(env, "POST", `/v10/projects/${projectId}/domains`, body);
    state = "created";
    observed = await vercel(env, "GET", `/v9/projects/${projectId}/domains/${hostname}`);
  } else {
    const delta = domainDelta(observed, desired);
    if (Object.keys(delta).length) {
      await vercel(env, "PATCH", `/v9/projects/${projectId}/domains/${hostname}`, delta);
      state = "updated";
      observed = await vercel(env, "GET", `/v9/projects/${projectId}/domains/${hostname}`);
    }
  }
  if (Object.keys(domainDelta(observed, desired)).length) throw new Error(`domain-readback-mismatch:${desired.name}`);
  return { state, domain: observed };
}

async function reconcile(env: Env): Promise<JsonObject> {
  const loaded = await loadDesiredState(env);
  if (!loaded.state.enabled) {
    return { ok: true, kind: "evavo-vercel-provider-desired-state-reconcile-v1", enabled: false, sourceRevision: loaded.revision, projects: [], credentialValuesReturned: false };
  }
  const results: JsonObject[] = [];
  for (const desired of loaded.state.projects) {
    const projectResult = await ensureProject(env, desired);
    const deploymentResult = await ensureDeployment(env, desired);
    const domains: JsonObject[] = [];
    for (const hostname of desired.domains) domains.push(await ensureDomain(env, desired.name, hostname));
    results.push({
      project: desired.name,
      repository: desired.repository,
      rootDirectory: desired.rootDirectory,
      productionBranch: desired.productionBranch,
      projectState: projectResult.state,
      deploymentState: deploymentResult.state,
      domains: domains.map((entry) => ({ state: entry.state, name: (entry.domain as JsonObject | undefined)?.name ?? null, verified: (entry.domain as JsonObject | undefined)?.verified === true, redirect: (entry.domain as JsonObject | undefined)?.redirect ?? null })),
    });
  }
  return {
    ok: true,
    schemaVersion: 1,
    kind: "evavo-vercel-provider-desired-state-reconcile-v1",
    enabled: true,
    sourceRepository: DESIRED_STATE_REPOSITORY,
    sourcePath: DESIRED_STATE_PATH,
    sourceRevision: loaded.revision,
    projectCount: results.length,
    projects: results,
    githubMutationPerformed: false,
    destructiveProviderOperationPerformed: false,
    workstationRequired: false,
    credentialValuesReturned: false,
  };
}

function bearer(request: Request): string | null {
  const match = /^Bearer\s+(.+)$/iu.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

function same(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/reconcile" && request.method === "POST") {
      const supplied = bearer(request);
      if (!supplied || !same(supplied, env.CONTROL_TOKEN)) {
        return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
      }
      try {
        return new Response(JSON.stringify(await reconcile(env)), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      } catch (error) {
        return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message.slice(0, 1800) : "reconcile-failed", credentialValuesReturned: false }), { status: 500, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      }
    }
    if (url.pathname === "/health" && request.method === "GET") {
      const base = await providerWorker.fetch(request, env, ctx);
      const payload = object(await base.json(), "base-health-invalid");
      return new Response(JSON.stringify({ ...payload, desiredStateReconcilerConfigured: Boolean(env.GITHUB_TOKEN), desiredStateRepository: DESIRED_STATE_REPOSITORY, desiredStatePath: DESIRED_STATE_PATH, desiredStateCronMinutes: 5 }), { status: base.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    return providerWorker.fetch(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(reconcile(env).then(() => undefined));
  },
};
