#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-doc-truth-runner-"));
const ADAPTER_PATH = path.join(ROOT, "config", "codex-worker-adapter-v1.json");
const ROUTES_PATH = path.join(ROOT, "config", "worker-capacity-routing-v1.json");
const ACCEPTANCE_POLICY_PATH = path.join(ROOT, "config", "codex-documentation-truth-physical-acceptance-v1.json");
const DISPATCH_POLICY_PATH = path.join(ROOT, "config", "codex-documentation-truth-dispatch-v1.json");
const sha = (character, length = 64) => character.repeat(length);

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}
const canonical = (value) => JSON.stringify(ordered(value));
const digest = (value) => createHash("sha256").update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")).digest("hex");
const iso = (milliseconds) => new Date(milliseconds).toISOString();

function runFile(executable, argv, options = {}) {
  const result = spawnSync(executable, argv, { encoding: "utf8", shell: false, timeout: 120_000, ...options });
  if (result.error) throw result.error;
  return result;
}
function git(cwd, argv) {
  const executable = process.platform === "win32" ? "git.exe" : "git";
  const result = runFile(executable, argv, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" } });
  if (result.status !== 0) throw new Error(`git ${argv.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

const fakeProgram = path.join(TEMP, "fake-codex.mjs");
fs.writeFileSync(fakeProgram, `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL || process.env.CODEX_API_KEY) process.exit(91);
const mode = process.env.FAKE_DOC_MODE || "success";
let summary;
if (mode === "success") {
  const manifest = {
    contractVersion: "evavo_repository_capabilities_v1",
    repository: "EVAVO-STUDIO/example",
    authority: "example",
    summary: "Example reusable capability authority supported by repository evidence.",
    capabilities: [{
      id: "example.inspect",
      title: "Inspect example state",
      description: "Read and compute a bounded example-state summary without mutation authority.",
      interfaces: ["library"],
      effects: ["read", "compute"],
      entrypoints: ["src/index.js"],
      tags: ["example", "inspection"],
      requires: ["Current repository state"]
    }]
  };
  fs.writeFileSync(path.join(process.cwd(), "evavo.capabilities.json"), JSON.stringify(manifest, null, 2) + "\\n");
  summary = { resultState: "SUCCESS", changedPaths: ["evavo.capabilities.json"], capabilitiesDeclared: ["example.inspect"], authorityDeclared: ["example"], evidenceUsed: ["admitted digest evidence"], assumptions: [], followUp: ["Run deterministic capability validation"] };
} else if (mode === "no-action") {
  summary = { resultState: "NO_ACTION", changedPaths: [], capabilitiesDeclared: [], authorityDeclared: [], evidenceUsed: ["current manifest evidence"], assumptions: [], followUp: [] };
} else if (mode === "forbidden") {
  fs.mkdirSync(path.join(process.cwd(), "src"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "src", "oops.txt"), "forbidden\\n");
  summary = { resultState: "SUCCESS", changedPaths: ["src/oops.txt"], capabilitiesDeclared: [], authorityDeclared: [], evidenceUsed: [], assumptions: [], followUp: [] };
} else {
  summary = { resultState: "BLOCKED", changedPaths: [], capabilitiesDeclared: [], authorityDeclared: [], evidenceUsed: [], assumptions: ["unknown fixture mode"], followUp: [] };
}
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(summary) } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { input_tokens: prompt.length, output_tokens: 10 } }) + "\\n");
`);
fs.chmodSync(fakeProgram, 0o755);
let fakeExecutable = fakeProgram;
if (process.platform === "win32") {
  fakeExecutable = path.join(TEMP, "fake-codex.cmd");
  fs.writeFileSync(fakeExecutable, `@echo off\r\n"${process.execPath}" "${fakeProgram}" %*\r\n`);
}

const adapter = {
  schemaVersion: 1,
  kind: "evavo-codex-worker-adapter-v1",
  runtime: "codex",
  executable: fakeExecutable,
  dispatch: {
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessExpected: false,
    apiKeyEnvironmentVariablesMustBeRemoved: ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY"],
    maximumRetainedStdoutBytes: 262144,
    maximumRetainedStderrBytes: 131072,
    paidFallbackAllowed: false,
    publicationAuthority: false,
    validationAuthority: false
  },
  spark: { routeId: "codex-spark-pro", preferredModel: "gpt-5.3-codex-spark", capacityClass: "included-consumer" }
};
const routes = {
  schemaVersion: 1,
  kind: "evavo-worker-capacity-routing",
  workerRoutes: [{
    id: "codex-spark-pro",
    runtime: "codex",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    workerClasses: ["test-generation", "documentation-truth"],
    maximumAutomaticConcurrency: 1,
    paidFallbackAllowed: false
  }]
};
const originals = new Map();
for (const [file, document] of [[ADAPTER_PATH, adapter], [ROUTES_PATH, routes]]) {
  originals.set(file, fs.existsSync(file) ? fs.readFileSync(file) : null);
  fs.writeFileSync(file, JSON.stringify(document, null, 2) + "\n");
}

function capability(now) {
  return {
    schemaVersion: 1,
    kind: "evavo-codex-worker-capability-probe-v1",
    observedAt: iso(now - 20_000),
    version: "codex-cli fixture 1.0.0",
    eligibleForWorkerDispatch: true,
    capabilities: { jsonFlag: "--json", modelFlag: "--model", sandboxFlag: "--sandbox", approvalFlag: "--ask-for-approval" }
  };
}
function buildAcceptance(capabilityBytes, now) {
  const policyBytes = fs.readFileSync(ACCEPTANCE_POLICY_PATH);
  const dispatchPolicyBytes = fs.readFileSync(DISPATCH_POLICY_PATH);
  const adapterBytes = fs.readFileSync(ADAPTER_PATH);
  const routeBytes = fs.readFileSync(ROUTES_PATH);
  const policy = JSON.parse(policyBytes);
  const fingerprint = {
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-acceptance-fingerprint-v1",
    policySha256: digest(policyBytes),
    dispatchPolicySha256: digest(dispatchPolicyBytes),
    adapterSha256: digest(adapterBytes),
    routeConfigSha256: digest(routeBytes),
    routeId: policy.routeId,
    modelPreference: policy.modelPreference,
    capacityClass: policy.capacityClass,
    authenticationClass: policy.requiredAuthenticationClass,
    sandboxMode: policy.sandboxMode,
    approvalPolicy: policy.approvalPolicy,
    workerClasses: policy.workerClasses,
    maximumConcurrency: policy.maximumConcurrency,
    codexVersion: "codex-cli fixture 1.0.0"
  };
  const evidence = Object.fromEntries(policy.requiredEvidence.map((key, index) => [key, { sha256: sha(String((index % 9) + 1)), byteLength: index + 100 }]));
  evidence["fresh-codex-capability-probe"] = { sha256: digest(capabilityBytes), byteLength: capabilityBytes.length };
  const body = {
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-physical-acceptance-v1",
    acceptedAt: iso(now - 60_000),
    routeId: policy.routeId,
    modelPreference: policy.modelPreference,
    capacityClass: policy.capacityClass,
    authenticationClass: policy.requiredAuthenticationClass,
    sandboxMode: policy.sandboxMode,
    approvalPolicy: policy.approvalPolicy,
    workerClasses: policy.workerClasses,
    maximumConcurrency: policy.maximumConcurrency,
    codexVersion: "codex-cli fixture 1.0.0",
    fixtureOnly: true,
    modelTurnCompleted: true,
    structuredTurnCompleted: true,
    successPathProven: true,
    noActionPathProven: true,
    pathBoundaryRejectionProven: true,
    currentHeadMismatchRejectionProven: true,
    authPolicyAccepted: true,
    apiKeyEnvironmentAbsent: true,
    paidFallbackUsed: false,
    candidateAuditAccepted: true,
    deterministicValidationPassed: true,
    primaryCheckoutUnchanged: true,
    workerCommitPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    cleanupComplete: true,
    acceptanceFingerprintSha256: digest(canonical(fingerprint)),
    evidence
  };
  return { ...body, receiptSha256: digest(canonical(body)) };
}
function initialiseCandidate(index) {
  const candidate = path.join(TEMP, `candidate-${index}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(candidate, { recursive: true });
  git(candidate, ["init", "-q"]);
  git(candidate, ["config", "user.email", "fixture@example.invalid"]);
  git(candidate, ["config", "user.name", "EVAVO Fixture"]);
  fs.writeFileSync(path.join(candidate, "README.md"), "# Fixture\n");
  fs.mkdirSync(path.join(candidate, "src"), { recursive: true });
  fs.writeFileSync(path.join(candidate, "src", "index.js"), "export const inspect = () => 'ok';\n");
  git(candidate, ["add", "."]);
  git(candidate, ["commit", "-q", "-m", "fixture"]);
  return { candidate, sourceRevision: git(candidate, ["rev-parse", "HEAD"]).toLowerCase() };
}
function verifyAcceptance(receiptPath, capabilityPath) {
  const result = runFile(process.execPath, ["scripts/verify-codex-documentation-truth-physical-acceptance.mjs", receiptPath, capabilityPath], { cwd: ROOT });
  if (result.status !== 0) throw new Error(`acceptance fixture failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

let fixtureCounter = 0;
function buildFixture() {
  const now = Date.now();
  const { candidate, sourceRevision } = initialiseCandidate(++fixtureCounter);
  const cap = capability(now);
  const capBytes = Buffer.from(JSON.stringify(cap), "utf8");
  const acceptance = buildAcceptance(capBytes, now);
  const acceptanceBytes = Buffer.from(JSON.stringify(acceptance), "utf8");
  const base = path.join(TEMP, `fixture-${fixtureCounter}`);
  fs.mkdirSync(base, { recursive: true });
  const capabilityPath = path.join(base, "capability.json");
  const acceptancePath = path.join(base, "acceptance.json");
  fs.writeFileSync(capabilityPath, capBytes);
  fs.writeFileSync(acceptancePath, acceptanceBytes);
  const verificationStdout = verifyAcceptance(acceptancePath, capabilityPath);

  const routeBody = {
    schemaVersion: 1,
    kind: "evavo-worker-route-plan-v1",
    eligible: true,
    decision: "DISPATCH_ELIGIBLE",
    workerClass: "documentation-truth",
    repository: "EVAVO-STUDIO/example",
    sourceRevision,
    routeId: "codex-spark-pro",
    runtime: "codex",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    capacityState: "AVAILABLE",
    rawCapacityState: "AVAILABLE",
    maximumConcurrency: 1,
    maximumAutomaticConcurrency: 1,
    capacityStatusSha256: sha("4"),
    routeAdmissionSha256: sha("5"),
    routeAdmissionObservedAt: iso(now - 15_000),
    routeAdmissionExpiresAt: iso(now + 360_000),
    supervisedAcceptanceSha256: digest(acceptanceBytes),
    capabilityReceiptSha256: digest(capBytes),
    capacityObservationSha256: sha("7"),
    acceptanceVerificationSha256: digest(Buffer.from(verificationStdout, "utf8")),
    paidFallbackUsed: false,
    executionPerformed: false,
    validationPerformed: false,
    publicationPerformed: false,
    truthBoundary: "fixture"
  };
  const route = { ...routeBody, routePlanSha256: digest(canonical(routeBody)) };
  const workerId = `doc-worker-${fixtureCounter}`;
  const work = {
    schemaVersion: 1,
    kind: "evavo-autonomous-improvement-work-item-v1",
    id: "work:capability-gap:" + digest(`${sourceRevision}:${fixtureCounter}`).slice(0, 24),
    lifecycleState: "LEASED",
    createdAt: iso(now - 120_000),
    updatedAt: iso(now - 10_000),
    origin: {
      producer: "brain-portfolio-health",
      evidenceFingerprintSha256: sha("b"),
      coverageReportSha256: sha("c"),
      candidateFingerprintSha256: sha("d"),
      repositoryHeadEvidenceSha256: sha("e"),
      admissionDecisionSha256: sha("f"),
      admissionPolicySha256: sha("1")
    },
    repository: "EVAVO-STUDIO/example",
    sourceRevision,
    repoTier: "T1",
    repositoryLifecycleState: "ACTIVE",
    category: "capability-manifest-gap",
    workClass: "capability-manifest-maintenance",
    workerClass: "documentation-truth",
    objective: "Declare only the reusable example inspection capability supported by this fixture.",
    capacityClass: "included-consumer",
    paidFallbackAllowed: false,
    allowedPaths: ["evavo.capabilities.json"],
    forbiddenPaths: ["src/**", ".git/**"],
    requiredValidation: ["capability-manifest-check"],
    maximumChangedFiles: 1,
    maximumChangedLines: 600,
    maximumAutomaticAttempts: 1,
    automaticAttempts: 0,
    documentationMetadataMutationAllowed: true,
    productionSourceMutationAllowed: false,
    dependencyChangeAllowed: false,
    schemaChangeAllowed: false,
    publicApiChangeAllowed: false,
    workerMayCommit: false,
    workerMayPush: false,
    workerMayPublish: false,
    publicationSeparated: true,
    requiresCurrentHeadMatch: true,
    noActionAccepted: true,
    dedupeKey: sha("3"),
    lease: {
      schemaVersion: 2,
      kind: "evavo-autonomous-work-exchange-lease-v2",
      planSha256: sha("9"),
      workerId,
      workerClass: "documentation-truth",
      repository: "EVAVO-STUDIO/example",
      sourceRevision,
      leasedAt: iso(now - 10_000),
      expiresAt: iso(now + 300_000),
      routeId: route.routeId,
      runtime: route.runtime,
      modelPreference: route.modelPreference,
      routePlanSha256: route.routePlanSha256,
      routeAdmissionSha256: route.routeAdmissionSha256,
      routeAdmissionObservedAt: route.routeAdmissionObservedAt,
      routeAdmissionExpiresAt: route.routeAdmissionExpiresAt,
      supervisedAcceptanceSha256: route.supervisedAcceptanceSha256,
      capabilityReceiptSha256: route.capabilityReceiptSha256,
      capacityObservationSha256: route.capacityObservationSha256,
      acceptanceVerificationSha256: route.acceptanceVerificationSha256,
      capacityStatusSha256: route.capacityStatusSha256,
      dispatchIntentSha256: sha("a"),
      oneWriterPerRepository: true,
      modelTurnPerformed: false
    }
  };
  const candidateReceipt = {
    schemaVersion: 1,
    kind: "evavo-autonomous-candidate-worktree-v1",
    workItemId: work.id,
    sourceRevision,
    sourceTreeSha: git(candidate, ["rev-parse", "HEAD^{tree}"]).toLowerCase(),
    candidate: { contract: "evavo_mainline_candidate_worktree_v1", path: candidate }
  };

  const workPath = path.join(base, "work.json");
  const routePath = path.join(base, "route.json");
  const candidateReceiptPath = path.join(base, "candidate.json");
  fs.writeFileSync(workPath, JSON.stringify(work));
  fs.writeFileSync(routePath, JSON.stringify(route));
  fs.writeFileSync(candidateReceiptPath, JSON.stringify(candidateReceipt));
  const compile = runFile(process.execPath, [
    "scripts/compile-codex-documentation-truth-dispatch.mjs",
    workPath,
    routePath,
    capabilityPath,
    candidateReceiptPath,
    workerId
  ], { cwd: ROOT });
  if (compile.status !== 0) throw new Error(`dispatch fixture compilation failed: ${compile.stderr}`);
  const planPath = path.join(base, "dispatch.json");
  fs.writeFileSync(planPath, compile.stdout);
  return { base, candidate, sourceRevision, capabilityPath, acceptancePath, acceptanceBytes, planPath };
}

function runRunner(fixture, { mode = "success", enabled = true, acceptancePath = fixture.acceptancePath, extraEnv = {}, dirtyBefore = null } = {}) {
  if (dirtyBefore) fs.writeFileSync(path.join(fixture.candidate, dirtyBefore), "dirty\n");
  const env = { ...process.env, FAKE_DOC_MODE: mode, OPENAI_API_KEY: "must-be-removed", ...extraEnv };
  if (enabled) env.EVAVO_CODEX_DOCUMENTATION_TRUTH_EXECUTION_ENABLED = "1";
  env.EVAVO_CODEX_DOCUMENTATION_TRUTH_ACCEPTANCE_RECEIPT = acceptancePath;
  const result = runFile(process.execPath, ["scripts/run-codex-documentation-truth-dispatch.mjs", fixture.planPath, fixture.capabilityPath], { cwd: ROOT, env, timeout: 180_000 });
  const channel = result.status === 0 ? result.stdout : result.stderr;
  return { result, document: JSON.parse(String(channel).trim()) };
}

try {
  {
    const fixture = buildFixture();
    const outcome = runRunner(fixture, { enabled: false });
    assert.equal(outcome.result.status, 1);
    assert.equal(outcome.document.started, false);
    assert.equal(outcome.document.modelTurnPerformed, false);
    assert.match(outcome.document.errors[0], /EXECUTION_ENABLED=1/);
  }

  {
    const fixture = buildFixture();
    const outcome = runRunner(fixture, { mode: "success" });
    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.equal(outcome.document.ok, true);
    assert.equal(outcome.document.resultState, "SUCCESS");
    assert.match(outcome.document.workItemSha256, /^[0-9a-f]{64}$/);
    assert.equal(outcome.document.acceptanceVerifiedAtStart, true);
    assert.deepEqual(outcome.document.changedPaths, ["evavo.capabilities.json"]);
    assert.equal(outcome.document.manifestAudit.authority, "example");
    assert.equal(outcome.document.manifestAudit.capabilityCount, 1);
    assert.equal(outcome.document.modelTurnPerformed, true);
    assert.equal(outcome.document.candidateWorktreeMutationPerformed, true);
    assert.equal(outcome.document.primaryRepositoryMutationPerformed, false);
    assert.equal(outcome.document.deterministicValidationPerformed, false);
    assert.equal(outcome.document.commitPerformed, false);
    assert.equal(outcome.document.pushPerformed, false);
    assert.equal(outcome.document.publicationPerformed, false);
    assert.equal(outcome.document.deploymentPerformed, false);
    assert.equal(outcome.document.paidFallbackUsed, false);
    assert.equal(outcome.document.apiKeyEnvironmentSanitized, true);
    assert.ok(outcome.document.apiKeyOrProviderEnvironmentRemoved.includes("OPENAI_API_KEY"));
    assert.match(outcome.document.receiptSha256, /^[0-9a-f]{64}$/);
    assert.equal(git(fixture.candidate, ["rev-parse", "HEAD"]).toLowerCase(), fixture.sourceRevision);
  }

  {
    const fixture = buildFixture();
    const outcome = runRunner(fixture, { mode: "no-action" });
    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.equal(outcome.document.resultState, "NO_ACTION");
    assert.deepEqual(outcome.document.changedPaths, []);
    assert.equal(outcome.document.candidateWorktreeMutationPerformed, false);
    assert.equal(git(fixture.candidate, ["status", "--porcelain=v1", "--untracked-files=all"]), "");
  }

  {
    const fixture = buildFixture();
    const outcome = runRunner(fixture, { mode: "forbidden" });
    assert.equal(outcome.result.status, 1);
    assert.equal(outcome.document.started, true);
    assert.match(outcome.document.errors[0], /forbidden path|canonical capability manifest/i);
  }

  {
    const fixture = buildFixture();
    const alternateAcceptance = path.join(fixture.base, "acceptance-reformatted.json");
    fs.writeFileSync(alternateAcceptance, JSON.stringify(JSON.parse(fixture.acceptanceBytes), null, 2) + "\n");
    const outcome = runRunner(fixture, { acceptancePath: alternateAcceptance });
    assert.equal(outcome.result.status, 1);
    assert.equal(outcome.document.started, false);
    assert.match(outcome.document.errors[0], /acceptance bytes differ/);
  }

  {
    const fixture = buildFixture();
    const outcome = runRunner(fixture, { dirtyBefore: "dirty.txt" });
    assert.equal(outcome.result.status, 1);
    assert.equal(outcome.document.started, false);
    assert.match(outcome.document.errors[0], /candidate must be clean/);
  }

  console.log("Codex documentation-truth runner tests passed.");
  console.log("- execution is impossible without the dedicated enable flag and exact physical-acceptance bytes");
  console.log("- exact capability, acceptance verification, candidate HEAD and clean state are rechecked before spawn");
  console.log("- SUCCESS permits one audited capability manifest; NO_ACTION leaves the candidate clean");
  console.log("- forbidden paths, dirty candidates and acceptance-byte drift fail closed");
  console.log("- API/provider overrides are stripped and no commit, push, validation, publication or deployment authority is gained");
} finally {
  for (const [file, bytes] of originals) {
    if (bytes === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, bytes);
  }
  fs.rmSync(TEMP, { recursive: true, force: true });
}
