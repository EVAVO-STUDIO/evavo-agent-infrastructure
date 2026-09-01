#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-doc-truth-dispatch-"));
const CANDIDATE = path.join(TEMP, "candidate");
const ADAPTER_PATH = path.join(ROOT, "config", "codex-worker-adapter-v1.json");
const NOW = "2026-09-01T11:00:00.000Z";
const sha = (character, length = 64) => character.repeat(length);

fs.mkdirSync(CANDIDATE, { recursive: true });

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}
const canonical = (value) => JSON.stringify(ordered(value));
const digest = (value) => createHash("sha256").update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")).digest("hex");

const adapter = {
  schemaVersion: 1,
  kind: "evavo-codex-worker-adapter-v1",
  executable: "codex",
  dispatch: {
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessExpected: false,
    apiKeyEnvironmentVariablesMustBeRemoved: ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY"],
    paidFallbackAllowed: false,
    publicationAuthority: false,
    validationAuthority: false
  },
  spark: {
    routeId: "codex-spark-pro",
    preferredModel: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer"
  }
};

const originalAdapter = fs.existsSync(ADAPTER_PATH) ? fs.readFileSync(ADAPTER_PATH) : null;
fs.writeFileSync(ADAPTER_PATH, JSON.stringify(adapter, null, 2) + "\n");

function capability(patch = {}) {
  return {
    schemaVersion: 1,
    kind: "evavo-codex-worker-capability-probe-v1",
    observedAt: "2026-09-01T10:59:40.000Z",
    eligibleForWorkerDispatch: true,
    capabilities: {
      jsonFlag: "--json",
      modelFlag: "--model",
      sandboxFlag: "--sandbox",
      approvalFlag: "--ask-for-approval"
    },
    ...patch
  };
}

function readyWork(patch = {}) {
  return {
    schemaVersion: 1,
    kind: "evavo-autonomous-improvement-work-item-v1",
    id: "work:capability-gap:" + sha("a", 24),
    lifecycleState: "LEASED",
    createdAt: NOW,
    updatedAt: "2026-09-01T10:59:50.000Z",
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
    sourceRevision: sha("2", 40),
    repoTier: "T1",
    repositoryLifecycleState: "ACTIVE",
    category: "capability-manifest-gap",
    workClass: "capability-manifest-maintenance",
    workerClass: "documentation-truth",
    objective: "Add the smallest truthful capability declaration supported by current repository evidence.",
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
    lease: null,
    ...patch
  };
}

function routeFor(work, capabilitySha, patch = {}) {
  const body = {
    schemaVersion: 1,
    kind: "evavo-worker-route-plan-v1",
    eligible: true,
    decision: "DISPATCH_ELIGIBLE",
    workerClass: work.workerClass,
    repository: work.repository,
    sourceRevision: work.sourceRevision,
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
    routeAdmissionObservedAt: "2026-09-01T10:59:30.000Z",
    routeAdmissionExpiresAt: "2026-09-01T11:05:00.000Z",
    supervisedAcceptanceSha256: sha("6"),
    capabilityReceiptSha256: capabilitySha,
    capacityObservationSha256: sha("7"),
    acceptanceVerificationSha256: sha("8"),
    paidFallbackUsed: false,
    executionPerformed: false,
    validationPerformed: false,
    publicationPerformed: false,
    truthBoundary: "fixture"
  };
  Object.assign(body, patch);
  return { ...body, routePlanSha256: digest(canonical(body)) };
}

function leaseFor(work, route, workerId, patch = {}) {
  return {
    schemaVersion: 2,
    kind: "evavo-autonomous-work-exchange-lease-v2",
    planSha256: sha("9"),
    workerId,
    workerClass: work.workerClass,
    repository: work.repository,
    sourceRevision: work.sourceRevision,
    leasedAt: "2026-09-01T10:59:50.000Z",
    expiresAt: "2026-09-01T11:04:30.000Z",
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
    modelTurnPerformed: false,
    ...patch
  };
}

function candidateReceipt(work, patch = {}) {
  return {
    schemaVersion: 1,
    kind: "evavo-autonomous-candidate-worktree-v1",
    workItemId: work.id,
    sourceRevision: work.sourceRevision,
    sourceTreeSha: sha("b", 40),
    candidate: {
      contract: "evavo_mainline_candidate_worktree_v1",
      path: CANDIDATE
    },
    ...patch
  };
}

function execute({ workPatch = {}, routePatch = {}, leasePatch = {}, capabilityPatch = {}, candidatePatch = {}, workerId = "doc-worker-1", corruptCapabilityAfterRoute = false } = {}) {
  let cap = capability(capabilityPatch);
  let capBytes = Buffer.from(JSON.stringify(cap), "utf8");
  const work = readyWork(workPatch);
  const route = routeFor(work, digest(capBytes), routePatch);
  work.lease = leaseFor(work, route, workerId, leasePatch);
  const candidate = candidateReceipt(work, candidatePatch);
  if (corruptCapabilityAfterRoute) {
    cap = { ...cap, observedAt: "2026-09-01T10:59:41.000Z" };
    capBytes = Buffer.from(JSON.stringify(cap), "utf8");
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const workPath = path.join(TEMP, `work-${suffix}.json`);
  const routePath = path.join(TEMP, `route-${suffix}.json`);
  const capabilityPath = path.join(TEMP, `capability-${suffix}.json`);
  const candidatePath = path.join(TEMP, `candidate-${suffix}.json`);
  fs.writeFileSync(workPath, JSON.stringify(work));
  fs.writeFileSync(routePath, JSON.stringify(route));
  fs.writeFileSync(capabilityPath, capBytes);
  fs.writeFileSync(candidatePath, JSON.stringify(candidate));

  const result = spawnSync(process.execPath, [
    "scripts/compile-codex-documentation-truth-dispatch.mjs",
    workPath,
    routePath,
    capabilityPath,
    candidatePath,
    workerId,
    "--now",
    NOW
  ], { cwd: ROOT, encoding: "utf8", shell: false, timeout: 120_000 });
  const channel = result.status === 0 ? result.stdout : result.stderr;
  return { result, document: JSON.parse(String(channel).trim()), work, route, capability: cap, candidate };
}

try {
  {
    const first = execute();
    assert.equal(first.result.status, 0, first.result.stderr);
    assert.equal(first.document.kind, "evavo-codex-documentation-truth-dispatch-plan-v1");
    assert.equal(first.document.eligible, true);
    assert.equal(first.document.workerClass, "documentation-truth");
    assert.equal(first.document.workItemSha256, digest(Buffer.from(JSON.stringify(first.work), "utf8")));
    assert.equal(first.document.maximumChangedFiles, 1);
    assert.equal(first.document.maximumChangedLines, 600);
    assert.equal(first.document.maximumAutomaticAttempts, 1);
    assert.equal(first.document.physicalDocumentationTruthAcceptanceRequired, true);
    assert.equal(first.document.networkAccessExpected, false);
    assert.equal(first.document.modelTurnPerformed, false);
    assert.equal(first.document.candidateWorktreeMutationPerformed, false);
    assert.equal(first.document.primaryRepositoryMutationPerformed, false);
    assert.equal(first.document.deterministicValidationPerformed, false);
    assert.equal(first.document.commitPerformed, false);
    assert.equal(first.document.pushPerformed, false);
    assert.equal(first.document.publicationPerformed, false);
    assert.equal(first.document.deploymentPerformed, false);
    assert.equal(first.document.paidFallbackUsed, false);
    assert.deepEqual(first.document.allowedPaths, ["evavo.capabilities.json"]);
    assert.match(first.document.stdinPrompt, /Prefer NO_ACTION/);
    assert.match(first.document.stdinPrompt, /do not invent runtime readiness/);
    assert.match(first.document.stdinPrompt, /Do not commit, push, publish, deploy/);
    const body = { ...first.document };
    const planSha = body.dispatchPlanSha256;
    delete body.dispatchPlanSha256;
    assert.equal(planSha, digest(canonical(body)));
    const second = execute().document;
    assert.equal(first.document.dispatchPlanSha256, second.dispatchPlanSha256, "equivalent fixed evidence must compile deterministically");
  }

  {
    const outcome = execute({ workPatch: { maximumChangedLines: undefined } });
    assert.equal(outcome.result.status, 1);
    assert.match(outcome.document.errors[0], /maximumChangedLines/);
  }

  {
    const outcome = execute({ leasePatch: { capacityStatusSha256: undefined } });
    assert.equal(outcome.result.status, 1);
    assert.match(outcome.document.errors[0], /lease capacityStatusSha256/);
  }

  {
    const outcome = execute({ leasePatch: { routeAdmissionSha256: sha("f") } });
    assert.equal(outcome.result.status, 1);
    assert.match(outcome.document.errors[0], /continuity failed/);
  }

  {
    const outcome = execute({ routePatch: { routeAdmissionObservedAt: "2026-09-01T10:40:00.000Z", routeAdmissionExpiresAt: "2026-09-01T11:05:00.000Z" } });
    assert.equal(outcome.result.status, 1);
    assert.match(outcome.document.errors[0], /stale/);
  }

  {
    const outcome = execute({ routePatch: { routeAdmissionObservedAt: "2026-09-01T10:59:30.000Z", routeAdmissionExpiresAt: "2026-09-01T11:20:00.000Z" }, leasePatch: { expiresAt: "2026-09-01T11:04:30.000Z" } });
    assert.equal(outcome.result.status, 1);
    assert.match(outcome.document.errors[0], /lifetime exceeds/);
  }

  {
    const outcome = execute({ corruptCapabilityAfterRoute: true });
    assert.equal(outcome.result.status, 1);
    assert.match(outcome.document.errors[0], /capability receipt bytes differ/);
  }

  {
    const outcome = execute({ candidatePatch: { sourceRevision: sha("c", 40) } });
    assert.equal(outcome.result.status, 1);
    assert.match(outcome.document.errors[0], /candidate worktree receipt does not match/);
  }

  {
    const outcome = execute({ workPatch: { allowedPaths: ["src/index.ts"] } });
    assert.equal(outcome.result.status, 1);
    assert.match(outcome.document.errors[0], /canonical capability manifest paths/);
  }

  {
    const outcome = execute({ workPatch: { paidFallbackAllowed: true } });
    assert.equal(outcome.result.status, 1);
    assert.match(outcome.document.errors[0], /paid fallback disabled/);
  }

  {
    const outcome = execute({ leasePatch: { expiresAt: "2026-09-01T10:59:59.000Z" } });
    assert.equal(outcome.result.status, 1);
    assert.match(outcome.document.errors[0], /lease is expired/);
  }

  console.log("Codex documentation-truth dispatch compiler tests passed.");
  console.log("- exact lease, route, capability bytes and candidate worktree identity are bound");
  console.log("- only one canonical capability manifest and 600 bounded lines are admitted");
  console.log("- missing limits, stale evidence, digest drift, paid fallback and path widening fail closed");
  console.log("- compilation performs no model, validation, primary-repository, Git, publication or deployment effect");
} finally {
  if (originalAdapter === null) fs.rmSync(ADAPTER_PATH, { force: true });
  else fs.writeFileSync(ADAPTER_PATH, originalAdapter);
  fs.rmSync(TEMP, { recursive: true, force: true });
}
