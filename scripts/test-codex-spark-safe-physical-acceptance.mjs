#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const policy = JSON.parse(fs.readFileSync("config/codex-spark-physical-acceptance-v1.json", "utf8"));
const adapter = JSON.parse(fs.readFileSync("config/codex-worker-adapter-v1.json", "utf8"));
const routeConfig = JSON.parse(fs.readFileSync("config/worker-capacity-routing-v1.json", "utf8"));
const route = routeConfig.workerRoutes.find((entry) => entry.id === policy.routeId);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-safe-acceptance-test-"));
try {
  const capability = {
    schemaVersion:1,
    kind:"evavo-codex-worker-capability-probe-v1",
    eligibleForWorkerDispatch:true,
    observedAt:new Date().toISOString(),
    version:"fixture-codex-version",
    capabilities:{jsonFlag:"--json",modelFlag:"--model",sandboxFlag:"--sandbox",approvalFlag:"--ask-for-approval"},
  };
  const fingerprintInput = {
    routeId:policy.routeId,
    modelPreference:policy.modelPreference,
    capacityClass:policy.capacityClass,
    sandboxMode:policy.sandboxMode,
    approvalPolicy:policy.approvalPolicy,
    codexVersion:capability.version,
    adapterKind:adapter.kind,
    adapterRuntime:adapter.runtime,
    routeWorkerClasses:route.workerClasses ?? [],
  };
  const evidence = Object.fromEntries((policy.requiredEvidence ?? []).map((key) => [key,{sha256:"a".repeat(64),bytes:1}]));
  const physicalAcceptance = {
    schemaVersion:1,
    kind:"evavo-codex-spark-physical-acceptance-v1",
    acceptedAt:new Date().toISOString(),
    routeId:policy.routeId,
    modelPreference:policy.modelPreference,
    capacityClass:policy.capacityClass,
    authenticationClass:policy.requiredAuthenticationClass,
    authPolicyAccepted:true,
    codexVersion:capability.version,
    sandboxMode:policy.sandboxMode,
    approvalPolicy:policy.approvalPolicy,
    fixtureOnly:true,
    modelTurnCompleted:true,
    structuredTurnCompleted:true,
    apiKeyEnvironmentAbsent:true,
    paidFallbackUsed:false,
    candidateAuditAccepted:true,
    deterministicValidationPassed:true,
    primaryCheckoutUnchanged:true,
    workerCommitPerformed:false,
    publicationPerformed:false,
    acceptedWorkerClasses:policy.initialWorkerClasses,
    maximumConcurrency:policy.initialMaximumConcurrency,
    acceptanceFingerprintSha256:sha256(Buffer.from(JSON.stringify(fingerprintInput),"utf8")),
    evidence,
  };
  const envelope = {
    schemaVersion:1,
    kind:"evavo-codex-spark-safe-physical-acceptance-v1",
    supervisedAt:new Date().toISOString(),
    physicalAcceptanceSha256:sha256(Buffer.from(JSON.stringify(physicalAcceptance),"utf8")),
    physicalAcceptance,
    supervision:{
      cleanupComplete:true,
      stagedAcceptancePromotedOnlyAfterCleanup:true,
      fixtureRepositoryMainUnchanged:true,
      fixtureRepositoryClean:true,
      fixtureRepositoryRemoteCount:0,
      registeredWorktreesAfterCleanup:1,
      cleanupEvidence:[],
      publicationPerformed:false,
      productRepositoryTouched:false,
    },
  };
  const capabilityPath = path.join(dir,"capability.json");
  const envelopePath = path.join(dir,"envelope.json");
  fs.writeFileSync(capabilityPath,JSON.stringify(capability));
  fs.writeFileSync(envelopePath,JSON.stringify(envelope));
  const run = () => spawnSync(process.execPath,["scripts/verify-codex-spark-safe-physical-acceptance.mjs",envelopePath,capabilityPath],{encoding:"utf8",shell:false,windowsHide:true});

  let result = run();
  assert.equal(result.status,0,result.stderr);
  let receipt = JSON.parse(result.stdout);
  assert.equal(receipt.accepted,true);
  assert.equal(receipt.supervisedCleanupProven,true);
  assert.deepEqual(receipt.workerClasses,policy.initialWorkerClasses);
  assert.equal(receipt.maximumConcurrency,policy.initialMaximumConcurrency);

  fs.writeFileSync(envelopePath,JSON.stringify({...envelope,supervision:{...envelope.supervision,cleanupComplete:false}}));
  result = run();
  assert.equal(result.status,1);
  receipt = JSON.parse(result.stdout);
  assert.equal(receipt.accepted,false);
  assert.ok(receipt.errors.some((entry)=>entry.includes("cleanup")));

  fs.writeFileSync(envelopePath,JSON.stringify({...envelope,physicalAcceptanceSha256:"b".repeat(64)}));
  result = run();
  assert.equal(result.status,1);
  receipt = JSON.parse(result.stdout);
  assert.ok(receipt.errors.some((entry)=>entry.includes("digest")));

  fs.writeFileSync(envelopePath,JSON.stringify(physicalAcceptance));
  result = run();
  assert.equal(result.status,1);
  receipt = JSON.parse(result.stdout);
  assert.ok(receipt.errors.some((entry)=>entry.includes("Supervised physical acceptance kind/schema")));

  console.log("Codex Spark supervised physical acceptance tests passed.");
  console.log("- a current internally consistent supervised envelope verifies without a model turn");
  console.log("- missing cleanup supervision fails closed");
  console.log("- nested physical-acceptance digest tampering fails closed");
  console.log("- a raw pre-cleanup physical acceptance is rejected by the supervised verifier");
} finally {
  fs.rmSync(dir,{recursive:true,force:true});
}
