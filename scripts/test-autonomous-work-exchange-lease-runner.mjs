#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-lease-runner-"));
const sha = (character, length = 64) => character.repeat(length);
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}
const canonical = (value) => JSON.stringify(ordered(value));
const digest = (value) => createHash("sha256").update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")).digest("hex");

function work(workerClass = "documentation-truth") {
  return {
    schemaVersion: 1,
    kind: "evavo-autonomous-improvement-work-item-v1",
    id: `work:${workerClass}:${sha("a", 24)}`,
    lifecycleState: "READY",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
    category: workerClass === "documentation-truth" ? "capability-manifest-gap" : "test-gap",
    workClass: workerClass === "documentation-truth" ? "capability-manifest-maintenance" : "test-expansion",
    workerClass,
    objective: "Maintain one truthful bounded artifact.",
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
    requiresCurrentHeadMatch: true,
    noActionAccepted: true,
    lease: null,
    dedupeKey: sha("3")
  };
}

function route(item) {
  const now = Date.now();
  const body = {
    schemaVersion: 1,
    kind: "evavo-worker-route-plan-v1",
    eligible: true,
    decision: "DISPATCH_ELIGIBLE",
    workerClass: item.workerClass,
    repository: item.repository,
    sourceRevision: item.sourceRevision,
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
    routeAdmissionObservedAt: new Date(now - 10_000).toISOString(),
    routeAdmissionExpiresAt: new Date(now + 300_000).toISOString(),
    supervisedAcceptanceSha256: sha("6"),
    capabilityReceiptSha256: sha("7"),
    capacityObservationSha256: sha("8"),
    acceptanceVerificationSha256: sha("9"),
    paidFallbackUsed: false,
    executionPerformed: false,
    validationPerformed: false,
    publicationPerformed: false,
    truthBoundary: "fixture"
  };
  return { ...body, routePlanSha256: digest(canonical(body)) };
}

function effectSource(mode = "valid") {
  return String.raw`from __future__ import annotations
import argparse, hashlib, json, sys
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--root', required=True)
p.add_argument('--plan-json', required=True)
p.add_argument('--agent-infrastructure-root')
p.add_argument('--runtime-grant-envelope')
p.add_argument('--runtime-grant-trust-anchor')
p.add_argument('--runtime-grant-request')
a=p.parse_args()
plan=json.loads(Path(a.plan_json).read_text(encoding='utf-8'))
is_doc=plan['workerClass']=='documentation-truth'
if is_doc and not all([a.agent_infrastructure_root,a.runtime_grant_envelope,a.runtime_grant_trust_anchor,a.runtime_grant_request]):
 print(json.dumps({'errorMessage':'grant evidence missing'}),file=sys.stderr); raise SystemExit(1)
if (not is_doc) and any([a.agent_infrastructure_root,a.runtime_grant_envelope,a.runtime_grant_trust_anchor,a.runtime_grant_request]):
 print(json.dumps({'errorMessage':'unexpected grant evidence'}),file=sys.stderr); raise SystemExit(1)
mode=${JSON.stringify(mode)}
state_path=Path(a.root)/'work-exchange-state.json'
before_bytes=state_path.read_bytes()
before_sha=hashlib.sha256(before_bytes).hexdigest()
state=json.loads(before_bytes.decode('utf-8'))
targets=[item for item in state['items'] if item.get('id')==plan['workItemId']]
if len(targets)!=1:
 print(json.dumps({'errorMessage':'target missing'}),file=sys.stderr); raise SystemExit(1)
target=targets[0]
target['lifecycleState']='LEASED'
target['updatedAt']=plan['leasedAt']
target['lease']={
 'schemaVersion':2,'kind':'evavo-autonomous-work-exchange-lease-v2','planSha256':plan['planSha256'],
 'workerId':plan['workerId'],'workerClass':plan['workerClass'],'repository':plan['repository'],
 'sourceRevision':plan['sourceRevision'],'leasedAt':plan['leasedAt'],'expiresAt':plan['leaseExpiresAt'],
 'routeId':plan['routeId'],'routeAdmissionSha256':plan['routeAdmissionSha256'],
 'dispatchIntentSha256':plan['dispatchIntentSha256'],'modelTurnPerformed':False
}
state['generation']=plan['expectedGeneration']+1
state['updatedAt']=plan['leasedAt']
after_bytes=(json.dumps(state,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
after_sha=hashlib.sha256(after_bytes).hexdigest()
if mode!='no-state-write': state_path.write_bytes(after_bytes)
if mode=='fail-after-mutation':
 print(json.dumps({'errorMessage':'synthetic post-mutation effect failure'}),file=sys.stderr); raise SystemExit(1)
receipt={
 'schemaVersion':2,'kind':'evavo-autonomous-work-exchange-lease-effect-receipt-v2','ok':True,
 'completedAt':plan['leasedAt'],'planSha256':plan['planSha256'],'workItemId':plan['workItemId'],
 'repository':plan['repository'],'sourceRevision':plan['sourceRevision'],'workerId':plan['workerId'],
 'workerClass':plan['workerClass'],'routeId':plan['routeId'],'routeAdmissionSha256':plan['routeAdmissionSha256'],
 'dispatchIntentSha256':plan['dispatchIntentSha256'],'expectedSnapshotSha256':plan['expectedSnapshotSha256'],
 'beforeStateSha256':before_sha,'afterStateSha256':after_sha,'beforeGeneration':plan['expectedGeneration'],
 'afterGeneration':plan['expectedGeneration']+1,'leaseExpiresAt':plan['leaseExpiresAt'],
 'reducerReceiptSha256':'e'*64,'idempotentReplaySafe':True,
 'runtimeGrantVerificationPerformed':is_doc,'grantConsumed':is_doc,'grantConsumptionRecorded':is_doc,
 'queueMutationPerformed':True,'itemsLeased':1,'leaseAcquired':True,'modelTurnPerformed':False,
 'deterministicValidationPerformed':False,'repositoryMutationPerformed':False,'commitPerformed':False,
 'pushPerformed':False,'publicationPerformed':False,'deploymentPerformed':False,
 'financialActionPerformed':False,'paidFallbackUsed':False
}
if is_doc:
 receipt.update({
  'runtimeActivationGrantId':'doc-truth:'+'a'*40,
  'runtimeActivationGrantBodySha256':'b'*64,
  'runtimeActivationGrantVerificationSha256':'c'*64,
  'runtimeGrantConsumptionSha256':'d'*64,
  'grantConsumedUses':1,
  'grantRemainingUses':0
 })
if mode=='missing-consumption': receipt['grantConsumed']=False
if mode=='publication': receipt['publicationPerformed']=True
if mode=='wrong-generation': receipt['afterGeneration']=plan['expectedGeneration']+2
if mode=='wrong-snapshot': receipt['beforeStateSha256']='f'*64
if mode=='wrong-expiry': receipt['leaseExpiresAt']=plan['leasedAt']
if mode=='unsafe-replay': receipt['idempotentReplaySafe']=False
body=json.dumps(receipt,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')
receipt['receiptSha256']=hashlib.sha256(body).hexdigest()
print(json.dumps(receipt))
`;
}

function registry(patch = {}) {
  return {
    schemaVersion: 1,
    kind: "evavo-autonomous-spark-task-registry-v1",
    canonicalWorkExchangeStoreAlreadyExists: true,
    autonomousLeaseActionPhysicallyRegistered: true,
    leaseActionPhysicallyRegistered: true,
    autonomousLeasePlanKind: "evavo-autonomous-work-exchange-lease-plan-v2",
    autonomousLeaseCommand: "scripts/Invoke-EvavoAutonomousWorkExchangeLease.py",
    autonomousLeaseWorkerClasses: ["test-generation", "documentation-truth"],
    autonomousLeaseRequiresExclusiveLock: true,
    autonomousLeaseRequiresExactSnapshotSha256: true,
    autonomousLeaseRequiresExpectedGeneration: true,
    autonomousLeaseCrashRecoveryRegistered: true,
    autonomousLeaseIdempotentReplayRegistered: true,
    documentationTruthLeaseRequiresRuntimeGrantVerification: true,
    documentationTruthRuntimeGrantVerificationPolicyVersion: 3,
    documentationTruthRuntimeGrantVerificationOccursUnderExclusiveLock: true,
    documentationTruthRuntimeGrantAtomicConsumptionRegistered: true,
    documentationTruthRuntimeGrantSingleUseEnforced: true,
    documentationTruthRuntimeGrantReuseRejected: true,
    documentationTruthRuntimeGrantLeaseExpiryBoundedByGrantExpiry: true,
    documentationTruthRuntimeGrantCrashRecoveryRegistered: true,
    documentationTruthRuntimeGrantIdempotentReplayRegistered: true,
    physicalCodexExecutionForNormalWorkRegistered: false,
    publicationAuthority: false,
    paidFallbackAllowed: false,
    ...patch
  };
}

function prepare({ workerClass = "documentation-truth", registryPatch = {}, effectMode = "valid" } = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const root = path.join(TEMP, suffix);
  const store = path.join(root, "store");
  const localStorage = path.join(root, "local-storage");
  const grants = path.join(root, "grants");
  fs.mkdirSync(store, { recursive: true });
  fs.mkdirSync(path.join(localStorage, "config"), { recursive: true });
  fs.mkdirSync(path.join(localStorage, "scripts"), { recursive: true });
  fs.mkdirSync(grants, { recursive: true });
  const item = work(workerClass);
  fs.writeFileSync(path.join(root, "work.json"), JSON.stringify(item));
  fs.writeFileSync(path.join(root, "route.json"), JSON.stringify(route(item)));
  fs.writeFileSync(path.join(store, "work-exchange-state.json"), JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-work-exchange-state-v1",
    generation: 4,
    updatedAt: new Date().toISOString(),
    items: [item]
  }));
  fs.writeFileSync(path.join(localStorage, "config", "autonomous-spark-task-registry-v1.json"), JSON.stringify(registry(registryPatch)));
  fs.writeFileSync(path.join(localStorage, "scripts", "Invoke-EvavoAutonomousWorkExchangeLease.py"), effectSource(effectMode));
  for (const name of ["envelope.json", "trust-anchor.json", "request.json"]) fs.writeFileSync(path.join(grants, name), "{}\n");
  return { root, store, localStorage, grants, workerClass };
}

function args(fixture, grantMode = fixture.workerClass === "documentation-truth" ? "complete" : "none") {
  const values = [
    "scripts/run-autonomous-work-exchange-lease.mjs",
    "--work-item", path.join(fixture.root, "work.json"),
    "--route-plan", path.join(fixture.root, "route.json"),
    "--worker-id", "spark-worker-1",
    "--work-exchange-root", fixture.store,
    "--local-storage-root", fixture.localStorage
  ];
  if (grantMode !== "none") {
    values.push("--agent-infrastructure-root", ROOT);
    values.push("--runtime-grant-envelope", path.join(fixture.grants, "envelope.json"));
    if (grantMode === "complete") {
      values.push("--runtime-grant-trust-anchor", path.join(fixture.grants, "trust-anchor.json"));
      values.push("--runtime-grant-request", path.join(fixture.grants, "request.json"));
    }
  }
  return values;
}

function execute(fixture, grantMode) {
  return spawnSync(process.execPath, args(fixture, grantMode), { cwd: ROOT, encoding: "utf8", shell: false, timeout: 30_000 });
}

function errorReceipt(result) {
  assert.equal(result.status, 1, result.stdout);
  return JSON.parse(result.stderr);
}

function assertPreEffectFailure(error) {
  assert.equal(error.kind, "evavo-autonomous-work-exchange-lease-run-error-v2");
  assert.equal(error.decision, "RETAIN_READY_JOB");
  assert.equal(error.canonicalLeaseEffectAttempted, false);
  assert.equal(error.effectReceiptReturned, false);
  assert.equal(error.effectReceiptValidated, false);
  assert.equal(error.leaseMutationStateKnown, true);
  assert.equal(error.reconciliationRequired, false);
  assert.equal(error.retrySafeFromThisReceipt, true);
  assert.equal(error.queueMutationPerformed, false);
  assert.equal(error.leaseAcquired, false);
  assert.equal(error.grantConsumed, false);
}

function assertPostEffectUnknown(error, { receiptReturned = true } = {}) {
  assert.equal(error.kind, "evavo-autonomous-work-exchange-lease-run-error-v2");
  assert.equal(error.decision, "RECONCILE_LEASE_STATE");
  assert.equal(error.canonicalLeaseEffectAttempted, true);
  assert.equal(error.effectReceiptReturned, receiptReturned);
  assert.equal(error.effectReceiptValidated, false);
  assert.equal(error.leaseMutationStateKnown, false);
  assert.equal(error.reconciliationRequired, true);
  assert.equal(error.retrySafeFromThisReceipt, false);
  assert.equal(error.queueMutationPerformed, null);
  assert.equal(error.leaseAcquired, null);
  assert.equal(error.runtimeGrantVerificationPerformed, null);
  assert.equal(error.grantConsumed, null);
  assert.equal(error.grantConsumptionRecorded, null);
}

try {
  {
    const result = execute(prepare());
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.kind, "evavo-autonomous-work-exchange-lease-run-v1");
    assert.equal(output.decision, "LEASE_ACQUIRED");
    assert.equal(output.workerClass, "documentation-truth");
    assert.equal(output.runtimeGrantVerificationPerformed, true);
    assert.equal(output.grantConsumed, true);
    assert.equal(output.grantConsumptionRecorded, true);
    assert.match(output.runtimeActivationGrantId, /^doc-truth:[0-9a-f]{40}$/);
    assert.equal(output.beforeGeneration, 4);
    assert.equal(output.afterGeneration, 5);
    assert.match(output.beforeStateSha256, /^[0-9a-f]{64}$/);
    assert.match(output.afterStateSha256, /^[0-9a-f]{64}$/);
    assert.notEqual(output.beforeStateSha256, output.afterStateSha256);
    assert.equal(output.effectReceiptValidated, true);
    assert.equal(output.canonicalStateReverifiedAfterEffect, true);
    assert.equal(output.leaseMutationStateKnown, true);
    assert.equal(output.retrySafeFromThisReceipt, false);
    assert.equal(output.leaseAcquired, true);
    assert.equal(output.modelTurnPerformed, false);
    assert.equal(output.publicationPerformed, false);
  }
  {
    const error = errorReceipt(execute(prepare(), "none"));
    assertPreEffectFailure(error);
    assert.match(error.errorMessage, /complete runtime-grant evidence set/);
  }
  {
    const error = errorReceipt(execute(prepare(), "partial"));
    assertPreEffectFailure(error);
    assert.match(error.errorMessage, /complete runtime-grant evidence set/);
  }
  {
    const error = errorReceipt(execute(prepare({ registryPatch: { documentationTruthRuntimeGrantAtomicConsumptionRegistered: false } })));
    assertPreEffectFailure(error);
    assert.match(error.errorMessage, /grant boundary differs/);
  }
  {
    const error = errorReceipt(execute(prepare({ effectMode: "missing-consumption" })));
    assertPostEffectUnknown(error);
    assert.match(error.errorMessage, /did not prove grantConsumed/);
  }
  {
    const result = execute(prepare({ workerClass: "test-generation" }), "none");
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.workerClass, "test-generation");
    assert.equal(output.runtimeGrantVerificationPerformed, false);
    assert.equal(output.grantConsumed, false);
    assert.equal(output.runtimeActivationGrantId, null);
    assert.equal(output.canonicalStateReverifiedAfterEffect, true);
  }
  {
    const error = errorReceipt(execute(prepare({ workerClass: "test-generation" }), "complete"));
    assertPreEffectFailure(error);
    assert.match(error.errorMessage, /forbidden for test-generation/);
  }
  {
    const error = errorReceipt(execute(prepare({ effectMode: "publication" })));
    assertPostEffectUnknown(error);
    assert.match(error.errorMessage, /widened authority/);
  }
  {
    const error = errorReceipt(execute(prepare({ effectMode: "wrong-generation" })));
    assertPostEffectUnknown(error);
    assert.match(error.errorMessage, /generation continuity/);
  }
  {
    const error = errorReceipt(execute(prepare({ effectMode: "wrong-snapshot" })));
    assertPostEffectUnknown(error);
    assert.match(error.errorMessage, /beforeStateSha256/);
  }
  {
    const error = errorReceipt(execute(prepare({ effectMode: "wrong-expiry" })));
    assertPostEffectUnknown(error);
    assert.match(error.errorMessage, /leaseExpiresAt continuity/);
  }
  {
    const error = errorReceipt(execute(prepare({ effectMode: "unsafe-replay" })));
    assertPostEffectUnknown(error);
    assert.match(error.errorMessage, /idempotent replay safety/);
  }
  {
    const error = errorReceipt(execute(prepare({ effectMode: "no-state-write" })));
    assertPostEffectUnknown(error);
    assert.match(error.errorMessage, /state bytes differ/);
  }
  {
    const error = errorReceipt(execute(prepare({ effectMode: "fail-after-mutation" })));
    assertPostEffectUnknown(error, { receiptReturned: false });
    assert.match(error.errorMessage, /synthetic post-mutation effect failure/);
  }
  {
    const fixture = prepare();
    const duplicateArgs = args(fixture);
    duplicateArgs.push("--worker-id", "other-worker");
    const result = spawnSync(process.execPath, duplicateArgs, { cwd: ROOT, encoding: "utf8", shell: false, timeout: 30_000 });
    const error = errorReceipt(result);
    assertPreEffectFailure(error);
    assert.match(error.errorMessage, /Duplicate option/);
  }
  console.log("Autonomous Work Exchange grant-bound lease-runner tests passed.");
  console.log("- successful lease receipts prove exact snapshot, generation, expiry and post-state continuity");
  console.log("- documentation-truth requires complete v3 grant evidence and test-generation remains grant-free");
  console.log("- failures before the canonical effect remain safely retryable READY work");
  console.log("- any unverified failure after the effect boundary requires canonical lease-state reconciliation before retry");
  console.log("- failed receipt validation can no longer falsely claim queueMutationPerformed=false or grantConsumed=false");
  console.log("- receipt/store divergence, wrong generation/snapshot/expiry and unsafe replay fail closed");
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true });
}
