#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = path.join(ROOT, "config", "codex-documentation-truth-dormant-fixture-campaign-v1.json");
const ADAPTER_PATH = path.join(ROOT, "config", "codex-worker-adapter-v1.json");
const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const SCENARIOS = [
  "validated-success",
  "validated-no-action",
  "forbidden-path-rejection",
  "stale-head-rejection",
];

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, ordered(value[key])]),
  );
}
const canonicalJson = (value) => JSON.stringify(ordered(value));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function without(value, key) { const copy = { ...value }; delete copy[key]; return copy; }
function seal(body, field) { return { ...body, [field]: sha256(Buffer.from(canonicalJson(body), "utf8")) }; }

function exactText(value, label, maximum = 4096) {
  if (typeof value !== "string" || !value || value.length > maximum || value.includes("\0")) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
  return value;
}
function exactSha(value, label, pattern = SHA256) {
  const selected = exactText(value, label, 64);
  if (!pattern.test(selected)) throw new Error(`${label} is invalid.`);
  return selected;
}
function regularFile(value, label, maximum = 32 * 1024 * 1024) {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximum) {
    throw new Error(`${label} must be a bounded regular non-symlink file.`);
  }
  return resolved;
}
function realDirectory(value, label) {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real non-symlink directory.`);
  return resolved;
}
function readJsonBytes(value, label, maximum = 32 * 1024 * 1024) {
  const resolved = regularFile(value, label, maximum);
  const bytes = fs.readFileSync(resolved);
  let document;
  try { document = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`${label} is not valid UTF-8 JSON.`); }
  if (!OBJECT(document)) throw new Error(`${label} must contain one JSON object.`);
  return { resolved, bytes, sha256: sha256(bytes), document };
}
function verifyDigest(value, field, label) {
  const observed = exactSha(value[field], `${label}.${field}`);
  const expected = sha256(Buffer.from(canonicalJson(without(value, field)), "utf8"));
  if (observed !== expected) throw new Error(`${label} digest does not match its canonical body.`);
  return observed;
}
function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const a = [...new Set(left.filter((entry) => typeof entry === "string"))].sort();
  const b = [...new Set(right.filter((entry) => typeof entry === "string"))].sort();
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}
function isInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function gitEnvironment(home) {
  return {
    PATH: process.env.PATH ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    SYSTEMROOT: process.env.SYSTEMROOT ?? "",
    WINDIR: process.env.WINDIR ?? "",
    HOME: home,
    USERPROFILE: home,
    GIT_AUTHOR_NAME: "EVAVO Documentation Truth Fixture",
    GIT_AUTHOR_EMAIL: "documentation-truth-fixture@example.invalid",
    GIT_COMMITTER_NAME: "EVAVO Documentation Truth Fixture",
    GIT_COMMITTER_EMAIL: "documentation-truth-fixture@example.invalid",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}
function git(repository, args, environment, timeout = 120_000) {
  return execFileSync(process.platform === "win32" ? "git.exe" : "git", args, {
    cwd: repository,
    env: environment,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}
function changedPaths(repository, environment) {
  const output = git(repository, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], environment);
  return output.split("\0").filter(Boolean).map((record) => record.slice(3).replaceAll("\\", "/")).sort();
}
function diffLineCount(repository, environment, relativePath) {
  const output = git(repository, ["diff", "--numstat", "HEAD", "--", relativePath], environment);
  if (!output) {
    const content = fs.readFileSync(path.join(repository, relativePath), "utf8");
    return content.split(/\r?\n/).filter((line) => line.length > 0).length;
  }
  const [added, deleted] = output.split(/\s+/);
  const left = Number.parseInt(added, 10);
  const right = Number.parseInt(deleted, 10);
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) throw new Error("Fixture diff line count is invalid.");
  return left + right;
}

function validateManifest(repository, relativePath) {
  const absolute = path.join(repository, relativePath);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 256_000) {
    throw new Error("Fixture capability manifest must be a bounded regular non-symlink file.");
  }
  const source = fs.readFileSync(absolute, "utf8");
  let value;
  try { value = JSON.parse(source); }
  catch { throw new Error("Fixture capability manifest is not valid JSON."); }
  if (!OBJECT(value)) throw new Error("Fixture capability manifest must be an object.");
  const allowedRoot = new Set(["contractVersion", "repository", "authority", "summary", "capabilities", "brain", "reviewedAt"]);
  const unknownRoot = Object.keys(value).filter((key) => !allowedRoot.has(key));
  if (unknownRoot.length > 0) throw new Error(`Fixture capability manifest contains unsupported fields: ${unknownRoot.join(", ")}.`);
  if (value.contractVersion !== "evavo_repository_capabilities_v1") throw new Error("Fixture capability manifest contractVersion is invalid.");
  if (value.repository !== "EVAVO-STUDIO/_documentation-truth-fixture") throw new Error("Fixture capability manifest repository identity is invalid.");
  if (!Array.isArray(value.capabilities) || value.capabilities.length !== 1) throw new Error("Fixture capability manifest must contain exactly one capability.");
  const capability = value.capabilities[0];
  if (!OBJECT(capability)) throw new Error("Fixture capability is invalid.");
  const capabilityKeys = ["id", "title", "description", "interfaces", "effects", "entrypoints", "tags", "requires"].sort();
  if (JSON.stringify(Object.keys(capability).sort()) !== JSON.stringify(capabilityKeys)) throw new Error("Fixture capability fields are invalid.");
  if (capability.id !== "fixture.documentation.truth") throw new Error("Fixture capability id is invalid.");
  if (!Array.isArray(capability.interfaces) || !capability.interfaces.includes("automation")) throw new Error("Fixture capability interfaces are invalid.");
  if (!Array.isArray(capability.effects) || JSON.stringify(capability.effects) !== JSON.stringify(["read", "compute"])) throw new Error("Fixture capability effects are invalid.");
  if (!OBJECT(value.brain) || value.brain.consult !== true || value.brain.sanityCheck !== true || !Array.isArray(value.brain.topics)) {
    throw new Error("Fixture capability manifest brain block is invalid.");
  }
  return { sha256: sha256(Buffer.from(source, "utf8")), bytes: Buffer.byteLength(source, "utf8") };
}

function exactWorkerSummary(value) {
  if (!OBJECT(value)) return false;
  const keys = ["assertionsAdded", "assumptions", "changedPaths", "followUp", "resultState"].sort();
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys)) return false;
  if (!new Set(["SUCCESS", "NO_ACTION", "BLOCKED", "NEEDS_HUMAN"]).has(value.resultState)) return false;
  return ["assertionsAdded", "assumptions", "changedPaths", "followUp"].every(
    (field) => Array.isArray(value[field]) && value[field].length <= 128 && value[field].every((entry) => typeof entry === "string" && entry.length <= 2048),
  );
}

function retain(value, maximumBytes) {
  const text = typeof value === "string" ? value : "";
  const bytes = Buffer.from(text, "utf8");
  return {
    sha256: sha256(bytes),
    byteLength: bytes.length,
    retained: bytes.length <= maximumBytes ? text : bytes.subarray(0, maximumBytes).toString("utf8"),
    truncated: bytes.length > maximumBytes,
  };
}

function defaultCodexExecutor({ cwd, prompt, capability, adapter, policy, scenario }) {
  if (process.env[policy.environment.explicitEnableVariable] !== policy.environment.requiredEnableValue) {
    throw new Error(`${policy.environment.explicitEnableVariable}=1 is required for a physical fixture campaign.`);
  }
  const childEnvironment = { ...process.env };
  const removed = [];
  for (const name of policy.environment.apiKeyAndProviderVariablesRemoved) {
    if (Object.prototype.hasOwnProperty.call(childEnvironment, name)) removed.push(name);
    delete childEnvironment[name];
  }
  childEnvironment.GIT_TERMINAL_PROMPT = "0";
  childEnvironment.GCM_INTERACTIVE = "Never";
  childEnvironment.EVAVO_AUTONOMOUS_WORKER = "1";
  childEnvironment.EVAVO_AUTONOMOUS_WORKER_CLASS = "documentation-truth";
  childEnvironment.EVAVO_DOCUMENTATION_TRUTH_FIXTURE_ONLY = "1";
  delete childEnvironment[policy.environment.explicitEnableVariable];
  const argv = [
    "exec",
    capability.capabilities.jsonFlag,
    capability.capabilities.modelFlag,
    policy.modelPreference,
    capability.capabilities.sandboxFlag,
    policy.sandboxMode,
    capability.capabilities.approvalFlag,
    policy.approvalPolicy,
    "-",
  ];
  const result = spawnSync(adapter.executable, argv, {
    cwd,
    env: childEnvironment,
    encoding: "utf8",
    input: prompt,
    shell: false,
    windowsHide: true,
    timeout: policy.maximumScenarioSeconds * 1000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const events = [];
  let malformed = 0;
  for (const line of stdout.split(/\r?\n/).filter((entry) => entry.trim())) {
    try {
      const event = JSON.parse(line);
      if (OBJECT(event)) events.push(event);
      else malformed += 1;
    } catch { malformed += 1; }
  }
  const turnCompleted = [...events].reverse().find((event) => event.type === "turn.completed") ?? null;
  const agentMessage = [...events].reverse().find(
    (event) => event.type === "item.completed" && event.item?.type === "agent_message",
  )?.item?.text ?? null;
  let workerSummary = null;
  try { if (typeof agentMessage === "string") workerSummary = JSON.parse(agentMessage); }
  catch {}
  return {
    status: result.status,
    signal: result.signal ?? null,
    error: result.error ?? null,
    stdout,
    stderr,
    modelTurnPerformed: Boolean(turnCompleted),
    structuredTurnCompleted: result.status === 0 && malformed === 0 && Boolean(turnCompleted) && exactWorkerSummary(workerSummary),
    workerSummary,
    removedEnvironment: removed,
    scenario,
  };
}

function manifestFixture() {
  return {
    contractVersion: "evavo_repository_capabilities_v1",
    repository: "EVAVO-STUDIO/_documentation-truth-fixture",
    authority: "fixture-only",
    summary: "Remote-less documentation-truth physical acceptance fixture.",
    capabilities: [
      {
        id: "fixture.documentation.truth",
        title: "Documentation truth fixture",
        description: "Proves one bounded manifest-only documentation-truth change without product or publication authority.",
        interfaces: ["automation", "testing"],
        effects: ["read", "compute"],
        entrypoints: ["evavo.capabilities.json"],
        tags: ["fixture", "documentation-truth"],
        requires: ["remote-less fixture repository"],
      },
    ],
    brain: {
      consult: true,
      sanityCheck: true,
      topics: ["documentation truth fixture"],
    },
    reviewedAt: "2026-09-01T00:00:00.000Z",
  };
}

function successPrompt() {
  return `You are an EVAVO documentation-truth fixture worker in a remote-less temporary repository.\nCreate exactly one file named evavo.capabilities.json and no other file. The file must contain exactly this JSON object:\n${JSON.stringify(manifestFixture(), null, 2)}\nDo not commit, push, publish, install, use network access or change Git metadata.\nYour final agent message must be JSON only with exactly these keys: resultState, changedPaths, assertionsAdded, assumptions, followUp. Set resultState to SUCCESS and changedPaths to [\"evavo.capabilities.json\"].`;
}
function noActionPrompt() {
  return "You are an EVAVO documentation-truth fixture worker. Inspect the existing evavo.capabilities.json. It is already complete and correct. Make no file changes. Do not commit, push, publish, install, use network access or change Git metadata. Your final agent message must be JSON only with exactly these keys: resultState, changedPaths, assertionsAdded, assumptions, followUp. Set resultState to NO_ACTION and changedPaths to [].";
}

function writeCreateOnly(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function validatePolicy(policy, adapter) {
  if (
    policy.schemaVersion !== 1 ||
    policy.kind !== "evavo-codex-documentation-truth-dormant-fixture-campaign-policy-v1" ||
    policy.owner !== "EVAVO-STUDIO/evavo-agent-infrastructure" ||
    policy.routeId !== "codex-spark-pro" || policy.modelPreference !== "gpt-5.3-codex-spark" ||
    policy.capacityClass !== "included-consumer" || policy.authenticationClass !== "chatgpt-consumer" ||
    policy.workerClass !== "documentation-truth" || policy.workClass !== "capability-manifest-maintenance" ||
    policy.sandboxMode !== "workspace-write" || policy.approvalPolicy !== "never" ||
    !sameStringSet(policy.allowedManifestPaths, ["evavo.capabilities.json", ".evavo/capabilities.json"]) ||
    policy.maximumChangedFiles !== 1 || policy.maximumChangedLines !== 600 ||
    !sameStringSet(policy.requiredScenarios, SCENARIOS) ||
    !sameStringSet(policy.modelScenarios, ["validated-success", "validated-no-action"]) ||
    !sameStringSet(policy.deterministicRejectionScenarios, ["forbidden-path-rejection", "stale-head-rejection"])
  ) throw new Error("Documentation-truth fixture campaign policy identity is invalid.");
  for (const authority of Object.values(policy.authority ?? {})) {
    if (authority !== false) throw new Error("Documentation-truth fixture campaign policy must have zero product authority.");
  }
  if (
    adapter.schemaVersion !== 1 || adapter.kind !== "evavo-codex-worker-adapter-v1" ||
    adapter.runtime !== "codex" || adapter.executable !== "codex" ||
    adapter.dispatch?.sandboxMode !== policy.sandboxMode || adapter.dispatch?.approvalPolicy !== policy.approvalPolicy ||
    adapter.dispatch?.paidFallbackAllowed !== false
  ) throw new Error("Codex adapter differs from documentation-truth fixture policy.");
}

function validateInputs(designSource, publicationSource, capabilitySource, policy, now) {
  const design = designSource.document;
  const publication = publicationSource.document;
  const capability = capabilitySource.document;
  if (
    design.schemaVersion !== 1 || design.kind !== "evavo-documentation-truth-cross-repository-activation-design-v1" ||
    design.ready !== true || design.decision !== "ACTIVATION_DESIGN_PACKET_READY" ||
    design.workerClass !== "documentation-truth" || design.workClass !== "capability-manifest-maintenance"
  ) throw new Error("Cross-repository design is not eligible for a physical fixture campaign.");
  verifyDigest(design, "designSha256", "Cross-repository design");
  if (
    publication.schemaVersion !== 1 || publication.kind !== "evavo-documentation-truth-dormant-publication-attestation-v1" ||
    publication.accepted !== true || publication.designSha256 !== design.designSha256 ||
    publication.agentInfrastructureExactRemoteMainConfirmed !== true ||
    publication.localStorageExactRemoteMainConfirmed !== true || publication.dormantSupportStillDisabled !== true
  ) throw new Error("Dormant publication attestation is not eligible for a physical fixture campaign.");
  verifyDigest(publication, "attestationSha256", "Dormant publication attestation");
  exactSha(publication.agentInfrastructureMainSha, "Agent Infrastructure main SHA", GIT_SHA);
  exactSha(publication.localStorageMainSha, "Local Storage main SHA", GIT_SHA);
  if (
    capability.schemaVersion !== 1 || capability.kind !== "evavo-codex-worker-capability-probe-v1" ||
    capability.eligibleForWorkerDispatch !== true || !capability.version ||
    !capability.capabilities?.jsonFlag || !capability.capabilities?.modelFlag ||
    !capability.capabilities?.sandboxFlag || !capability.capabilities?.approvalFlag
  ) throw new Error("Fresh eligible Codex capability receipt is required.");
  const observedAt = Date.parse(capability.observedAt ?? "");
  if (!Number.isFinite(observedAt) || observedAt - now.getTime() > 120_000 || now.getTime() - observedAt > 600_000) {
    throw new Error("Codex capability receipt is stale or future-dated.");
  }
  return { design, publication, capability };
}

export function runCodexDocumentationTruthDormantFixtureCampaign({
  designPath,
  publicationPath,
  capabilityPath,
  evidenceBaseDirectory,
  now = new Date(),
  codexExecutor = defaultCodexExecutor,
  requirePhysicalEnable = true,
}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Campaign time is invalid.");
  if (requirePhysicalEnable && process.env.EVAVO_DOCUMENTATION_TRUTH_FIXTURE_CAMPAIGN_ENABLED !== "1") {
    throw new Error("EVAVO_DOCUMENTATION_TRUTH_FIXTURE_CAMPAIGN_ENABLED=1 is required.");
  }
  const policySource = readJsonBytes(POLICY_PATH, "Fixture campaign policy", 4 * 1024 * 1024);
  const adapterSource = readJsonBytes(ADAPTER_PATH, "Codex adapter", 4 * 1024 * 1024);
  validatePolicy(policySource.document, adapterSource.document);
  const designSource = readJsonBytes(designPath, "Cross-repository design");
  const publicationSource = readJsonBytes(publicationPath, "Dormant publication attestation");
  const capabilitySource = readJsonBytes(capabilityPath, "Codex capability receipt", 4 * 1024 * 1024);
  const { design, publication, capability } = validateInputs(
    designSource,
    publicationSource,
    capabilitySource,
    policySource.document,
    now,
  );
  const evidenceBase = realDirectory(evidenceBaseDirectory, "Evidence base directory");
  if (isInside(evidenceBase, ROOT) || isInside(ROOT, evidenceBase)) {
    throw new Error("Evidence base must be outside and independent of Agent Infrastructure source.");
  }

  const campaignId = `doc-truth-${now.toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${randomBytes(8).toString("hex")}`;
  const evidenceDirectory = fs.mkdtempSync(path.join(evidenceBase, `${campaignId}-`));
  fs.chmodSync(evidenceDirectory, 0o700);
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${campaignId}-fixture-`));
  const repository = path.join(fixtureRoot, "repository");
  const candidates = path.join(fixtureRoot, "candidates");
  const home = path.join(fixtureRoot, "home");
  fs.mkdirSync(repository);
  fs.mkdirSync(candidates);
  fs.mkdirSync(home);
  const environment = gitEnvironment(home);
  const scenarioReceipts = {};
  const startedAt = new Date().toISOString();
  let baseSha = null;
  let baseTreeSha = null;
  let noActionSeedSha = null;
  let primaryMainUnchanged = false;
  let primaryClean = false;
  let remoteCount = null;
  let worktreeCount = null;

  try {
    git(repository, ["init", "-b", "main"], environment);
    fs.writeFileSync(path.join(repository, "fixture-base.txt"), "remote-less documentation truth fixture\n", "utf8");
    git(repository, ["add", "fixture-base.txt"], environment);
    git(repository, ["commit", "-m", "Create documentation truth fixture base"], environment);
    baseSha = git(repository, ["rev-parse", "HEAD^{commit}"], environment).toLowerCase();
    baseTreeSha = git(repository, ["rev-parse", "HEAD^{tree}"], environment).toLowerCase();
    if (!GIT_SHA.test(baseSha) || !GIT_SHA.test(baseTreeSha)) throw new Error("Fixture base Git identity is invalid.");
    remoteCount = Number.parseInt(git(repository, ["remote"], environment) ? "1" : "0", 10);
    if (remoteCount !== 0) throw new Error("Fixture repository must remain remote-less.");

    const seedPath = path.join(candidates, "no-action-seed");
    git(repository, ["worktree", "add", "--detach", seedPath, baseSha], environment, 300_000);
    fs.writeFileSync(path.join(seedPath, "evavo.capabilities.json"), `${JSON.stringify(manifestFixture(), null, 2)}\n`, "utf8");
    git(seedPath, ["add", "evavo.capabilities.json"], environment);
    git(seedPath, ["commit", "-m", "Create complete documentation truth fixture manifest"], environment);
    noActionSeedSha = git(seedPath, ["rev-parse", "HEAD^{commit}"], environment).toLowerCase();
    git(repository, ["worktree", "remove", "--force", seedPath], environment);

    const executeModelScenario = ({ name, sourceSha, prompt, expectedState }) => {
      const candidatePath = path.join(candidates, name);
      git(repository, ["worktree", "add", "--detach", candidatePath, sourceSha], environment, 300_000);
      const beforeHead = git(candidatePath, ["rev-parse", "HEAD^{commit}"], environment).toLowerCase();
      if (beforeHead !== sourceSha || changedPaths(candidatePath, environment).length !== 0) {
        throw new Error(`Fixture candidate preflight failed: ${name}.`);
      }
      const execution = codexExecutor({
        cwd: candidatePath,
        prompt,
        capability,
        adapter: adapterSource.document,
        policy: policySource.document,
        scenario: name,
      });
      const afterHead = git(candidatePath, ["rev-parse", "HEAD^{commit}"], environment).toLowerCase();
      if (afterHead !== beforeHead) throw new Error(`Fixture worker changed Git HEAD: ${name}.`);
      const paths = changedPaths(candidatePath, environment);
      const summary = execution.workerSummary;
      const structured = execution.structuredTurnCompleted === true && exactWorkerSummary(summary);
      let accepted = false;
      let changedLines = 0;
      let evidence;
      if (expectedState === "SUCCESS") {
        if (!structured || summary.resultState !== "SUCCESS") throw new Error("Validated-success fixture did not return a structured SUCCESS summary.");
        if (JSON.stringify(paths) !== JSON.stringify(["evavo.capabilities.json"])) throw new Error("Validated-success fixture changed an inadmissible path set.");
        if (JSON.stringify(summary.changedPaths) !== JSON.stringify(paths)) throw new Error("Validated-success worker summary differs from physical changed paths.");
        const manifest = validateManifest(candidatePath, paths[0]);
        changedLines = diffLineCount(candidatePath, environment, paths[0]);
        if (changedLines < 1 || changedLines > policySource.document.maximumChangedLines) throw new Error("Validated-success fixture changed-line count is invalid.");
        evidence = { manifest, changedPaths: paths, changedLines, structuredSummarySha256: sha256(Buffer.from(canonicalJson(summary), "utf8")) };
        accepted = true;
      } else {
        if (!structured || summary.resultState !== "NO_ACTION") throw new Error("Validated-NO_ACTION fixture did not return a structured NO_ACTION summary.");
        if (paths.length !== 0 || summary.changedPaths.length !== 0) throw new Error("Validated-NO_ACTION fixture changed files.");
        const manifest = validateManifest(candidatePath, "evavo.capabilities.json");
        evidence = { manifest, changedPaths: [], changedLines: 0, structuredSummarySha256: sha256(Buffer.from(canonicalJson(summary), "utf8")) };
        accepted = true;
      }
      const stdout = retain(execution.stdout, policySource.document.maximumRetainedStdoutBytes);
      const stderr = retain(execution.stderr, policySource.document.maximumRetainedStderrBytes);
      const scenarioBody = {
        schemaVersion: 1,
        kind: "evavo-codex-documentation-truth-dormant-fixture-scenario-v1",
        scenario: name,
        fixtureId: campaignId,
        observedAt: new Date().toISOString(),
        designSha256: design.designSha256,
        agentInfrastructureMainSha: publication.agentInfrastructureMainSha,
        localStorageMainSha: publication.localStorageMainSha,
        fixtureOnly: true,
        workerClass: "documentation-truth",
        workClass: "capability-manifest-maintenance",
        routeId: policySource.document.routeId,
        modelPreference: policySource.document.modelPreference,
        capacityClass: policySource.document.capacityClass,
        codexVersion: capability.version,
        evidenceSha256: sha256(Buffer.from(canonicalJson({ evidence, stdout, stderr }), "utf8")),
        accepted,
        resultState: expectedState,
        externalValidationAccepted: accepted,
        changedFiles: paths.length,
        changedLines,
        changedPaths: paths,
        modelTurnPerformed: execution.modelTurnPerformed === true,
        candidateMutationPersisted: expectedState === "SUCCESS",
        commitPerformed: false,
        pushPerformed: false,
        publicationPerformed: false,
        deploymentPerformed: false,
        financialActionPerformed: false,
        paidFallbackUsed: false,
      };
      const receipt = seal(scenarioBody, "receiptSha256");
      writeCreateOnly(path.join(evidenceDirectory, `${name}.json`), receipt);
      scenarioReceipts[name] = receipt;
      git(repository, ["worktree", "remove", "--force", candidatePath], environment);
    };

    executeModelScenario({
      name: "validated-success",
      sourceSha: baseSha,
      prompt: successPrompt(),
      expectedState: "SUCCESS",
    });
    executeModelScenario({
      name: "validated-no-action",
      sourceSha: noActionSeedSha,
      prompt: noActionPrompt(),
      expectedState: "NO_ACTION",
    });

    {
      const name = "forbidden-path-rejection";
      const candidatePath = path.join(candidates, name);
      git(repository, ["worktree", "add", "--detach", candidatePath, baseSha], environment, 300_000);
      fs.writeFileSync(path.join(candidatePath, "README.md"), "forbidden fixture mutation\n", "utf8");
      const paths = changedPaths(candidatePath, environment);
      if (JSON.stringify(paths) !== JSON.stringify(["README.md"])) throw new Error("Forbidden-path fixture setup is invalid.");
      const rejection = { reason: "FORBIDDEN_PATH", changedPaths: paths, allowedPaths: policySource.document.allowedManifestPaths };
      const scenarioBody = {
        schemaVersion: 1,
        kind: "evavo-codex-documentation-truth-dormant-fixture-scenario-v1",
        scenario: name,
        fixtureId: campaignId,
        observedAt: new Date().toISOString(),
        designSha256: design.designSha256,
        agentInfrastructureMainSha: publication.agentInfrastructureMainSha,
        localStorageMainSha: publication.localStorageMainSha,
        fixtureOnly: true,
        workerClass: "documentation-truth",
        workClass: "capability-manifest-maintenance",
        routeId: policySource.document.routeId,
        modelPreference: policySource.document.modelPreference,
        capacityClass: policySource.document.capacityClass,
        codexVersion: capability.version,
        evidenceSha256: sha256(Buffer.from(canonicalJson(rejection), "utf8")),
        accepted: false,
        rejected: true,
        rejectionReason: "FORBIDDEN_PATH",
        externalValidationAccepted: false,
        modelTurnPerformed: false,
        candidateMutationPersisted: false,
        commitPerformed: false,
        pushPerformed: false,
        publicationPerformed: false,
        deploymentPerformed: false,
        financialActionPerformed: false,
        paidFallbackUsed: false,
      };
      const receipt = seal(scenarioBody, "receiptSha256");
      writeCreateOnly(path.join(evidenceDirectory, `${name}.json`), receipt);
      scenarioReceipts[name] = receipt;
      git(repository, ["worktree", "remove", "--force", candidatePath], environment);
    }

    {
      const name = "stale-head-rejection";
      const candidatePath = path.join(candidates, name);
      git(repository, ["worktree", "add", "--detach", candidatePath, baseSha], environment, 300_000);
      const expectedHead = git(candidatePath, ["rev-parse", "HEAD^{commit}"], environment).toLowerCase();
      git(candidatePath, ["checkout", "--detach", noActionSeedSha], environment);
      const observedHead = git(candidatePath, ["rev-parse", "HEAD^{commit}"], environment).toLowerCase();
      if (expectedHead === observedHead) throw new Error("Stale-head fixture did not create source drift.");
      const rejection = { reason: "STALE_HEAD", expectedHead, observedHead };
      const scenarioBody = {
        schemaVersion: 1,
        kind: "evavo-codex-documentation-truth-dormant-fixture-scenario-v1",
        scenario: name,
        fixtureId: campaignId,
        observedAt: new Date().toISOString(),
        designSha256: design.designSha256,
        agentInfrastructureMainSha: publication.agentInfrastructureMainSha,
        localStorageMainSha: publication.localStorageMainSha,
        fixtureOnly: true,
        workerClass: "documentation-truth",
        workClass: "capability-manifest-maintenance",
        routeId: policySource.document.routeId,
        modelPreference: policySource.document.modelPreference,
        capacityClass: policySource.document.capacityClass,
        codexVersion: capability.version,
        evidenceSha256: sha256(Buffer.from(canonicalJson(rejection), "utf8")),
        accepted: false,
        rejected: true,
        rejectionReason: "STALE_HEAD",
        externalValidationAccepted: false,
        modelTurnPerformed: false,
        candidateMutationPersisted: false,
        commitPerformed: false,
        pushPerformed: false,
        publicationPerformed: false,
        deploymentPerformed: false,
        financialActionPerformed: false,
        paidFallbackUsed: false,
      };
      const receipt = seal(scenarioBody, "receiptSha256");
      writeCreateOnly(path.join(evidenceDirectory, `${name}.json`), receipt);
      scenarioReceipts[name] = receipt;
      git(repository, ["worktree", "remove", "--force", candidatePath], environment);
    }

    git(repository, ["worktree", "prune", "--expire", "now"], environment);
    primaryMainUnchanged = git(repository, ["rev-parse", "HEAD^{commit}"], environment).toLowerCase() === baseSha;
    primaryClean = changedPaths(repository, environment).length === 0;
    remoteCount = git(repository, ["remote"], environment) ? 1 : 0;
    const worktreeList = git(repository, ["worktree", "list", "--porcelain"], environment);
    worktreeCount = worktreeList.split(/\r?\n/).filter((line) => line.startsWith("worktree ")).length;
    if (!primaryMainUnchanged || !primaryClean || remoteCount !== 0 || worktreeCount !== 1) {
      throw new Error("Fixture cleanup or unchanged-main proof failed.");
    }
    if (!sameStringSet(Object.keys(scenarioReceipts), SCENARIOS)) throw new Error("Fixture scenario receipt set is incomplete.");
    const supervisionBody = {
      schemaVersion: 1,
      kind: "evavo-codex-documentation-truth-dormant-fixture-supervision-v1",
      fixtureId: campaignId,
      completedAt: new Date().toISOString(),
      designSha256: design.designSha256,
      agentInfrastructureMainSha: publication.agentInfrastructureMainSha,
      localStorageMainSha: publication.localStorageMainSha,
      workerClass: "documentation-truth",
      workClass: "capability-manifest-maintenance",
      routeId: policySource.document.routeId,
      modelPreference: policySource.document.modelPreference,
      codexVersion: capability.version,
      scenarioReceiptSha256: Object.fromEntries(
        SCENARIOS.map((name) => [name, scenarioReceipts[name].receiptSha256]),
      ),
      fixtureOnly: true,
      fixtureRepositoryRemoteCount: remoteCount,
      fixturePrimaryCheckoutClean: primaryClean,
      fixtureMainUnchanged: primaryMainUnchanged,
      candidateCleanupComplete: true,
      registeredWorktreesAfterCleanup: worktreeCount,
      normalRouteWasUnchanged: true,
      workerCommitPerformed: false,
      commitPerformed: false,
      pushPerformed: false,
      publicationPerformed: false,
      deploymentPerformed: false,
      financialActionPerformed: false,
      paidFallbackUsed: false,
    };
    const supervision = seal(supervisionBody, "receiptSha256");
    writeCreateOnly(path.join(evidenceDirectory, "supervision.json"), supervision);
    const manifestBody = {
      schemaVersion: 1,
      kind: "evavo-codex-documentation-truth-dormant-fixture-campaign-v1",
      fixtureId: campaignId,
      startedAt,
      completedAt: supervision.completedAt,
      designSha256: design.designSha256,
      publicationAttestationSha256: publication.attestationSha256,
      agentInfrastructureMainSha: publication.agentInfrastructureMainSha,
      localStorageMainSha: publication.localStorageMainSha,
      capabilityReceiptSha256: capabilitySource.sha256,
      policySha256: policySource.sha256,
      adapterSha256: adapterSource.sha256,
      scenarioReceiptSha256: supervision.scenarioReceiptSha256,
      supervisionReceiptSha256: supervision.receiptSha256,
      fixtureOnly: true,
      productRepositoryTouched: false,
      normalRouteMutationPerformed: false,
      workerCommitPerformed: false,
      pushPerformed: false,
      publicationPerformed: false,
      deploymentPerformed: false,
      financialActionPerformed: false,
      paidFallbackUsed: false,
      truthBoundary:
        "This campaign physically exercises only a newly created remote-less fixture repository and writes receipts only to a new external evidence directory. Product repositories and normal route configuration are untouched.",
    };
    const campaign = seal(manifestBody, "campaignSha256");
    writeCreateOnly(path.join(evidenceDirectory, "campaign.json"), campaign);
    return { evidenceDirectory, campaign, supervision, scenarioReceipts };
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function parseCli(values) {
  const options = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || options.has(key)) {
      throw new Error("Usage: node scripts/run-codex-documentation-truth-dormant-fixture-campaign.mjs --design <json> --publication <json> --capability <json> --evidence-base <directory>");
    }
    options.set(key, value);
  }
  for (const key of ["--design", "--publication", "--capability", "--evidence-base"]) {
    if (!options.has(key)) throw new Error(`Missing required option ${key}.`);
  }
  return options;
}

const directInvocation = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directInvocation) {
  try {
    const options = parseCli(process.argv.slice(2));
    const result = runCodexDocumentationTruthDormantFixtureCampaign({
      designPath: options.get("--design"),
      publicationPath: options.get("--publication"),
      capabilityPath: options.get("--capability"),
      evidenceBaseDirectory: options.get("--evidence-base"),
      requirePhysicalEnable: true,
    });
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      kind: "evavo-codex-documentation-truth-dormant-fixture-campaign-run-v1",
      ok: true,
      evidenceDirectory: result.evidenceDirectory,
      campaignSha256: result.campaign.campaignSha256,
      supervisionReceiptSha256: result.supervision.receiptSha256,
      scenarioReceiptSha256: result.supervision.scenarioReceiptSha256,
      productRepositoryTouched: false,
      normalRouteMutationPerformed: false,
      workerCommitPerformed: false,
      pushPerformed: false,
      publicationPerformed: false,
      deploymentPerformed: false,
      financialActionPerformed: false,
      paidFallbackUsed: false,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      kind: "evavo-codex-documentation-truth-dormant-fixture-campaign-run-v1",
      ok: false,
      errors: [String(error?.message ?? error).slice(0, 2000)],
      productRepositoryTouched: false,
      normalRouteMutationPerformed: false,
      workerCommitPerformed: false,
      pushPerformed: false,
      publicationPerformed: false,
      deploymentPerformed: false,
      financialActionPerformed: false,
      paidFallbackUsed: false,
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
