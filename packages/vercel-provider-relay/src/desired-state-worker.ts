import providerWorker from "./worker";

type JsonObject = Record<string, unknown>;

type Env = {
  VERCEL_TOKEN: string;
  VERCEL_TEAM_ID: string;
  CONTROL_TOKEN: string;
  GITHUB_TOKEN: string;
};

type DesiredDomain = {
  name: string;
  redirect?: string;
  redirectStatusCode?: 301 | 302 | 307 | 308;
};

type DesiredProject = {
  name: string;
  repository: string;
  rootDirectory: string;
  productionBranch: string;
  deployIfMissing: boolean;
  domains: DesiredDomain[];
};

type DesiredState = {
  schemaVersion: 1;
  kind: "evavo-vercel-provider-desired-state-v1";
  enabled: boolean;
  projects: DesiredProject[];
};

const GITHUB_API = "https://api.github.com";
const VERCEL_API = "https://api.vercel.com";
const DESIRED_REPOSITORY = "EVAVO-STUDIO/evavo-agent-infrastructure";
const DESIRED_PATH = "config/vercel-provider-desired-state-v1.json";
const MAX_BODY_BYTES = 512 * 1024;
const MAX_PROJECTS = 20;
const MAX_DOMAINS = 20;
const LIVE_DEPLOYMENT_STATES = new Set(["READY", "BUILDING", "QUEUED", "INITIALIZING"]);

function asObject(value: unknown, code = "object-required"): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonObject;
}

function asText(value: unknown, code: string, max = 500): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(code);
  }
  return value;
}

function projectName(value: unknown): string {
  const result = asText(value, "project-name-invalid", 100);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u.test(result)) throw new Error("project-name-invalid");
  return result;
}

function repository(value: unknown): string {
  const result = asText(value, "repository-invalid", 180);
  if (!/^EVAVO-STUDIO\/[A-Za-z0-9._-]{1,100}$/u.test(result)) throw new Error("repository-not-evavo");
  return result;
}

function repoParts(full: string): { org: string; repo: string } {
  const slash = full.indexOf("/");
  if (slash <= 0 || slash >= full.length - 1) throw new Error("repository-invalid");
  return { org: full.slice(0, slash), repo: full.slice(slash + 1) };
}

function rootDirectory(value: unknown): string {
  const result = asText(value, "root-directory-invalid", 300).replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
  if (!result || result.includes("..") || result.startsWith(".")) throw new Error("root-directory-invalid");
  return result;
}

function branch(value: unknown): string {
  const result = asText(value, "branch-invalid", 200);
  if (!/^[A-Za-z0-9._/-]+$/u.test(result) || result.includes("..") || result.startsWith("/") || result.endsWith("/")) {
    throw new Error("branch-invalid");
  }
  return result;
}

function hostname(value: unknown): string {
  const result = asText(value, "domain-invalid", 253).toLowerCase().replace(/\.$/u, "");
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(result)) {
    throw new Error("domain-invalid");
  }
  return result;
}

function parseDesiredState(value: unknown): DesiredState {
  const raw = asObject(value, "desired-state-object-required");
  if (raw.schemaVersion !== 1 || raw.kind !== "evavo-vercel-provider-desired-state-v1") throw new Error("desired-state-contract-invalid");
  if (raw.enabled !== true && raw.enabled !== false) throw new Error("desired-state-enabled-invalid");
  if (!Array.isArray(raw.projects) || raw.projects.length > MAX_PROJECTS) throw new Error("desired-state-projects-invalid");

  const seenProjects = new Set<string>();
  const projects: DesiredProject[] = raw.projects.map((entry) => {
    const item = asObject(entry, "desired-project-object-required");
    const name = projectName(item.name);
    if (seenProjects.has(name)) throw new Error("desired-project-duplicate");
    seenProjects.add(name);

    const desiredRepository = repository(item.repository);
    const desiredRoot = rootDirectory(item.rootDirectory);
    const productionBranch = branch(item.productionBranch ?? "main");
    const deployIfMissing = item.deployIfMissing !== false;
    if (!Array.isArray(item.domains) || item.domains.length > MAX_DOMAINS) throw new Error("desired-domains-invalid");

    const seenDomains = new Set<string>();
    const domains = item.domains.map((entryDomain): DesiredDomain => {
      const row = asObject(entryDomain, "desired-domain-object-required");
      const nameValue = hostname(row.name);
      if (seenDomains.has(nameValue)) throw new Error("desired-domain-duplicate");
      seenDomains.add(nameValue);
      const result: DesiredDomain = { name: nameValue };
      if (row.redirect !== undefined && row.redirect !== null) result.redirect = hostname(row.redirect);
      if (row.redirectStatusCode !== undefined) {
        const code = Number(row.redirectStatusCode);
        if (![301, 302, 307, 308].includes(code)) throw new Error("redirect-status-invalid");
        result.redirectStatusCode = code as 301 | 302 | 307 | 308;
      }
      return result;
    });

    return {
      name,
      repository: desiredRepository,
      rootDirectory: desiredRoot,
      productionBranch,
      deployIfMissing,
      domains,
    };
  });

  return {
    schemaVersion: 1,
    kind: "evavo-vercel-provider-desired-state-v1",
    enabled: raw.enabled as boolean,
    projects,
  };
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const output: JsonObject = {};
  for (const [key, entry] of Object.entries(value as JsonObject)) {
    output[key] = /token|secret|password|private.?key|api.?key/iu.test(key) ? "[redacted]" : redact(entry);
  }
  return output;
}

async function boundedJson(response: Response, code: string): Promise<JsonObject> {
  const raw = await response.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new Error(`${code}-too-large`);
  let parsed: unknown = {};
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { throw new Error(`${code}-invalid-json`); }
  }
  if (!response.ok) throw new Error(`${code}-${response.status}:${JSON.stringify(redact(parsed)).slice(0, 1200)}`);
  return asObject(parsed, `${code}-object-required`);
}

async function githubGet(env: Env, path: string): Promise<JsonObject> {
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
  const raw = asText(value, "github-content-invalid", MAX_BODY_BYTES).replace(/\s+/gu, "");
  try {
    const bytes = Uint8Array.from(atob(raw), (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("github-content-decode-failed");
  }
}

async function loadDesiredState(env: Env): Promise<{ revision: string; state: DesiredState }> {
  const commit = await githubGet(env, `/repos/${DESIRED_REPOSITORY}/commits/main`);
  const revision = asText(commit.sha, "github-main-invalid", 40).toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(revision)) throw new Error("github-main-invalid");

  const encodedPath = DESIRED_PATH.split("/").map(encodeURIComponent).join("/");
  const file = await githubGet(env, `/repos/${DESIRED_REPOSITORY}/contents/${encodedPath}?ref=${revision}`);
  if (file.type !== "file" || file.encoding !== "base64") throw new Error("desired-state-file-invalid");

  let parsed: unknown;
  try { parsed = JSON.parse(decodeBase64(file.content)); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("github-content-")) throw error;
    throw new Error("desired-state-json-invalid");
  }
  return { revision, state: parseDesiredState(parsed) };
}

async function vercel(env: Env, method: string, path: string, body?: JsonObject): Promise<JsonObject> {
  if (!env.VERCEL_TOKEN || !env.VERCEL_TEAM_ID) throw new Error("vercel-credential-missing");
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
  if (!response.ok) throw new Error(`vercel-${response.status}:${JSON.stringify(redact(parsed)).slice(0, 1500)}`);
  return asObject(parsed, "vercel-response-invalid");
}

async function vercelOptionalGet(env: Env, path: string): Promise<JsonObject | null> {
  try { return await vercel(env, "GET", path); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("vercel-404:")) return null;
    throw error;
  }
}

function gitMatches(project: JsonObject, desiredRepository: string): boolean {
  const link = project.link;
  if (!link || typeof link !== "object" || Array.isArray(link)) return false;
  const current = link as JsonObject;
  const desired = repoParts(desiredRepository);
  return String(current.type ?? "").toLowerCase() === "github"
    && String(current.org ?? "").toLowerCase() === desired.org.toLowerCase()
    && String(current.repo ?? "").toLowerCase() === desired.repo.toLowerCase();
}

function normalizedRoot(value: unknown): string {
  return String(value ?? "").replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
}

async function ensureProject(env: Env, desired: DesiredProject): Promise<{ state: string; project: JsonObject }> {
  let current = await vercelOptionalGet(env, `/v9/projects/${encodeURIComponent(desired.name)}`);
  let state = "present";
  if (!current) {
    await vercel(env, "POST", "/v11/projects", {
      name: desired.name,
      rootDirectory: desired.rootDirectory,
      gitRepository: { type: "github", repo: desired.repository },
    });
    state = "created";
    current = await vercel(env, "GET", `/v9/projects/${encodeURIComponent(desired.name)}`);
  } else {
    if (!gitMatches(current, desired.repository)) throw new Error(`project-git-link-mismatch:${desired.name}`);
    if (normalizedRoot(current.rootDirectory) !== desired.rootDirectory) {
      await vercel(env, "PATCH", `/v9/projects/${encodeURIComponent(desired.name)}`, { rootDirectory: desired.rootDirectory });
      state = "updated";
      current = await vercel(env, "GET", `/v9/projects/${encodeURIComponent(desired.name)}`);
    }
  }
  if (!gitMatches(current, desired.repository)) throw new Error(`project-git-readback-mismatch:${desired.name}`);
  if (normalizedRoot(current.rootDirectory) !== desired.rootDirectory) throw new Error(`project-root-readback-mismatch:${desired.name}`);
  return { state, project: current };
}

async function ensureDeployment(env: Env, desired: DesiredProject): Promise<{ state: string; deployment?: JsonObject }> {
  const query = new URLSearchParams({ projectId: desired.name, target: "production", limit: "5" });
  const listed = await vercel(env, "GET", `/v6/deployments?${query.toString()}`);
  const deployments = Array.isArray(listed.deployments)
    ? listed.deployments.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) as JsonObject[]
    : [];
  const current = deployments.find((entry) => LIVE_DEPLOYMENT_STATES.has(String(entry.state ?? entry.readyState ?? "").toUpperCase()));
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

function domainDelta(current: JsonObject, desired: DesiredDomain): JsonObject {
  const delta: JsonObject = {};
  if (desired.redirect !== undefined && current.redirect !== desired.redirect) delta.redirect = desired.redirect;
  if (desired.redirectStatusCode !== undefined && Number(current.redirectStatusCode) !== desired.redirectStatusCode) {
    delta.redirectStatusCode = desired.redirectStatusCode;
  }
  return delta;
}

async function ensureDomain(env: Env, project: string, desired: DesiredDomain): Promise<{ state: string; domain: JsonObject }> {
  const encodedProject = encodeURIComponent(project);
  const encodedDomain = encodeURIComponent(desired.name);
  let current = await vercelOptionalGet(env, `/v9/projects/${encodedProject}/domains/${encodedDomain}`);
  let state = "present";
  if (!current) {
    const body: JsonObject = { name: desired.name };
    if (desired.redirect !== undefined) body.redirect = desired.redirect;
    if (desired.redirectStatusCode !== undefined) body.redirectStatusCode = desired.redirectStatusCode;
    await vercel(env, "POST", `/v10/projects/${encodedProject}/domains`, body);
    state = "created";
    current = await vercel(env, "GET", `/v9/projects/${encodedProject}/domains/${encodedDomain}`);
  } else {
    const delta = domainDelta(current, desired);
    if (Object.keys(delta).length) {
      await vercel(env, "PATCH", `/v9/projects/${encodedProject}/domains/${encodedDomain}`, delta);
      state = "updated";
      current = await vercel(env, "GET", `/v9/projects/${encodedProject}/domains/${encodedDomain}`);
    }
  }
  if (Object.keys(domainDelta(current, desired)).length) throw new Error(`domain-readback-mismatch:${desired.name}`);
  return { state, domain: current };
}

async function reconcile(env: Env): Promise<JsonObject> {
  const loaded = await loadDesiredState(env);
  if (!loaded.state.enabled) {
    return {
      ok: true,
      schemaVersion: 1,
      kind: "evavo-vercel-provider-desired-state-reconcile-v1",
      enabled: false,
      sourceRevision: loaded.revision,
      projects: [],
      workstationRequired: false,
      credentialValuesReturned: false,
    };
  }

  const results: JsonObject[] = [];
  for (const desired of loaded.state.projects) {
    const ensuredProject = await ensureProject(env, desired);
    const ensuredDeployment = await ensureDeployment(env, desired);
    const domains: JsonObject[] = [];
    for (const desiredDomain of desired.domains) {
      const result = await ensureDomain(env, desired.name, desiredDomain);
      domains.push({
        state: result.state,
        name: result.domain.name ?? desiredDomain.name,
        verified: result.domain.verified === true,
        redirect: result.domain.redirect ?? null,
        redirectStatusCode: result.domain.redirectStatusCode ?? null,
      });
    }
    results.push({
      project: desired.name,
      repository: desired.repository,
      rootDirectory: desired.rootDirectory,
      productionBranch: desired.productionBranch,
      projectState: ensuredProject.state,
      deploymentState: ensuredDeployment.state,
      domains,
    });
  }

  return {
    ok: true,
    schemaVersion: 1,
    kind: "evavo-vercel-provider-desired-state-reconcile-v1",
    enabled: true,
    sourceRepository: DESIRED_REPOSITORY,
    sourcePath: DESIRED_PATH,
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
      const payload = asObject(await base.json(), "base-health-invalid");
      return new Response(JSON.stringify({
        ...payload,
        desiredStateReconcilerConfigured: Boolean(env.GITHUB_TOKEN),
        desiredStateRepository: DESIRED_REPOSITORY,
        desiredStatePath: DESIRED_PATH,
        desiredStateCronMinutes: 5,
      }), { status: base.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }

    return providerWorker.fetch(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(reconcile(env).then(() => undefined));
  },
};
