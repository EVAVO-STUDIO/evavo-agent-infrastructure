#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const names = ["capability","auth","work","candidate","run","capacity","audit","seal","validation","primary"];
const values = process.argv.slice(2);
if (values.length !== names.length) {
  console.error("Usage: node scripts/compile-codex-spark-physical-acceptance.mjs <capability.json> <auth.json> <work.json> <candidate.json> <run.json> <capacity.json> <audit.json> <seal.json> <validation.json> <primary.json>");
  process.exit(2);
}

const policy = JSON.parse(fs.readFileSync("config/codex-spark-physical-acceptance-v1.json", "utf8"));
const adapter = JSON.parse(fs.readFileSync("config/codex-worker-adapter-v1.json", "utf8"));
const routeConfig = JSON.parse(fs.readFileSync("config/worker-capacity-routing-v1.json", "utf8"));
const route = (routeConfig.workerRoutes ?? []).find((entry) => entry.id === policy.routeId);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const evidence = {};
const docs = {};
for (let index = 0; index < names.length; index += 1) {
  const file = path.resolve(values[index]);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Evidence ${names[index]} must be a regular non-symlink file.`);
  const bytes = fs.readFileSync(file);
  docs[names[index]] = JSON.parse(bytes.toString("utf8"));
  evidence[names[index]] = {sha256:sha256(bytes), bytes:bytes.length};
}

const {capability, auth, work, candidate, run, capacity, audit, seal, validation, primary} = docs;
const errors = [];
const same = (label, ...items) => {
  const filtered = items.filter((value) => value !== undefined && value !== null);
  if (new Set(filtered.map(String)).size > 1) errors.push(`${label} evidence identities disagree.`);
};

if (!route || route.modelPreference !== policy.modelPreference || route.capacityClass !== policy.capacityClass || route.paidFallbackAllowed !== false) errors.push("Current Spark route violates acceptance policy.");
if (capability.kind !== "evavo-codex-worker-capability-probe-v1" || capability.eligibleForWorkerDispatch !== true) errors.push("Fresh eligible Codex capability evidence is required.");
if (auth.kind !== "evavo-codex-chatgpt-auth-policy-probe-v1" || auth.accepted !== true || auth.authenticationClass !== "chatgpt-consumer") errors.push("ChatGPT-only Codex auth policy evidence is required.");
if (work.fixtureOnly !== true || work.workerClass !== "test-generation" || work.paidFallbackAllowed !== false) errors.push("Physical acceptance work item must be a test-generation fixture with paid fallback disabled.");
if (candidate.kind !== "evavo-autonomous-candidate-worktree-v1") errors.push("Isolated candidate receipt is invalid.");
if (run.kind !== "evavo-codex-worker-run-v1" || run.routeId !== policy.routeId) errors.push("Codex worker run receipt is invalid.");
if (run.modelTurnCompleted !== true || run.structuredTurnCompleted !== true || run.jsonl?.turnCompleted !== true || run.jsonl?.malformedLines !== 0) errors.push("Fixture Codex turn did not complete as valid structured JSONL.");
if (run.apiKeyEnvironmentSanitized !== true || run.paidFallbackUsed !== false) errors.push("Fixture run did not prove sanitized zero-paid-fallback environment.");
if (run.candidateHeadChanged !== false || run.publicationPerformed !== false) errors.push("Fixture worker exceeded candidate/Git authority.");
if (capacity.kind !== "evavo-codex-worker-result-classification-v1" || capacity.capacityState !== "AVAILABLE" || capacity.paidFallbackUsed !== false) errors.push("Fixture capacity classification must be AVAILABLE with no paid fallback.");
if (audit.kind !== "evavo-autonomous-candidate-audit-v1" || audit.accepted !== true || Number(audit.changedFiles ?? 0) < 1) errors.push("Fixture candidate audit must accept a real bounded change.");
if (seal.kind !== "evavo-autonomous-candidate-seal-v1" || seal.sealed !== true || seal.commitObjectMovedHead !== false || seal.dirtyCandidateRemoved !== true) errors.push("Fixture candidate was not safely sealed for validation.");
const validationPassed = validation.kind === "evavo-codex-spark-fixture-validation-v1"
  ? validation.passed === true
  : validation.contract === "evavo_mainline_validation_evidence_envelope_v1"
    ? validation.body?.outcome === "passed"
    : false;
if (!validationPassed) errors.push("Deterministic fixture validation did not pass.");
if (primary.kind !== "evavo-autonomous-primary-checkout-attestation-v1" || primary.primaryCheckoutUnchanged !== true || primary.clean !== true) errors.push("Primary checkout unchanged evidence is required.");

same("work-item", work.id, candidate.workItemId, run.workItemId, audit.workItemId, seal.workItemId, primary.workItemId);
same("repository", work.repository, candidate.repository, run.repository, audit.repository, seal.repository, primary.repository);
same("source revision", work.sourceRevision, candidate.sourceRevision, run.sourceRevision, audit.sourceRevision, seal.baseSourceRevision, primary.expectedSourceRevision, primary.observedHead);
if (seal.commitParentSha !== work.sourceRevision) errors.push("Sealed candidate parent differs from fixture source revision.");
if (run.sandboxMode !== policy.sandboxMode || run.approvalPolicy !== policy.approvalPolicy) errors.push("Fixture run sandbox/approval policy differs from acceptance policy.");

if (errors.length) {
  console.error(JSON.stringify({kind:"evavo-codex-spark-physical-acceptance-v1",accepted:false,errors}, null, 2));
  process.exit(1);
}

const evidenceMap = {
  "fresh-codex-capability-probe": evidence.capability,
  "chatgpt-auth-policy-probe": evidence.auth,
  "fixture-work-item": evidence.work,
  "isolated-candidate-receipt": evidence.candidate,
  "codex-run-receipt": evidence.run,
  "capacity-classification": evidence.capacity,
  "accepted-candidate-audit": evidence.audit,
  "sealed-candidate-receipt": evidence.seal,
  "deterministic-validation-evidence": evidence.validation,
  "primary-checkout-unchanged-attestation": evidence.primary,
};
const fingerprintInput = {
  routeId: policy.routeId,
  modelPreference: policy.modelPreference,
  capacityClass: policy.capacityClass,
  sandboxMode: policy.sandboxMode,
  approvalPolicy: policy.approvalPolicy,
  codexVersion: capability.version,
  adapterKind: adapter.kind,
  adapterRuntime: adapter.runtime,
  routeWorkerClasses: route.workerClasses ?? [],
};
const receipt = {
  schemaVersion: 1,
  kind: "evavo-codex-spark-physical-acceptance-v1",
  acceptedAt: new Date().toISOString(),
  routeId: policy.routeId,
  modelPreference: policy.modelPreference,
  capacityClass: policy.capacityClass,
  authenticationClass: "chatgpt-consumer",
  authPolicyAccepted: true,
  codexVersion: capability.version,
  sandboxMode: policy.sandboxMode,
  approvalPolicy: policy.approvalPolicy,
  fixtureOnly: true,
  modelTurnCompleted: true,
  structuredTurnCompleted: true,
  apiKeyEnvironmentAbsent: true,
  paidFallbackUsed: false,
  candidateAuditAccepted: true,
  deterministicValidationPassed: true,
  primaryCheckoutUnchanged: true,
  workerCommitPerformed: false,
  publicationPerformed: false,
  acceptedWorkerClasses: policy.initialWorkerClasses,
  maximumConcurrency: policy.initialMaximumConcurrency,
  acceptanceFingerprintSha256: sha256(Buffer.from(JSON.stringify(fingerprintInput), "utf8")),
  evidence: evidenceMap,
  truthBoundary: "This temporary physical acceptance admits only the initial worker classes/concurrency in policy. It does not grant publication authority and expires or invalidates on material Codex/adapter/route changes."
};
console.log(JSON.stringify(receipt, null, 2));
