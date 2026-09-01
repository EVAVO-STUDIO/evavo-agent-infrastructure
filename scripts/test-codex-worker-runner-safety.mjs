#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-codex-runner-safety-"));
try {
  const plan = path.join(dir, "plan.json");
  const capability = path.join(dir, "capability.json");
  const basePlan = {
    kind:"evavo-codex-worker-dispatch-plan-v1", eligible:true, executable:"codex", publicationAuthority:false, validationAuthority:false, paidFallbackUsed:false,
    sandboxMode:"workspace-write", approvalPolicy:"never",
    argv:["exec","--json","--model","gpt-5.3-codex-spark","--sandbox","workspace-write","--ask-for-approval","never","-"],
    stdinPrompt:"fixture", workingDirectory:dir, sourceRevision:"a".repeat(40), workItemId:"work:fixture", workerId:"spark-fixture", repository:"EVAVO-STUDIO/example", fixtureOnly:false,
  };
  fs.writeFileSync(plan, JSON.stringify(basePlan));
  fs.writeFileSync(capability, JSON.stringify({
    kind:"evavo-codex-worker-capability-probe-v1", eligibleForWorkerDispatch:true, observedAt:new Date().toISOString(), version:"fixture",
    capabilities:{jsonFlag:"--json",modelFlag:"--model",sandboxFlag:"--sandbox",approvalFlag:"--ask-for-approval"}
  }));

  const controls = ["EVAVO_CODEX_SPARK_EXECUTION_ENABLED","EVAVO_CODEX_SPARK_PROFILE_ACCEPTED","EVAVO_CODEX_SPARK_ACCEPTANCE_RECEIPT","EVAVO_CODEX_SPARK_CERTIFICATION_MODE","EVAVO_CODEX_CHATGPT_AUTH_POLICY_ACCEPTED"];
  const run = (envPatch = {}, planPatch = {}) => {
    fs.writeFileSync(plan, JSON.stringify({...basePlan, ...planPatch}));
    const env = {...process.env, ...envPatch};
    for (const name of controls) if (envPatch[name] === null) delete env[name];
    return spawnSync(process.execPath, ["scripts/run-codex-worker-dispatch.mjs", plan, capability], {encoding:"utf8", shell:false, env});
  };

  let result = run({EVAVO_CODEX_SPARK_EXECUTION_ENABLED:null,EVAVO_CODEX_SPARK_PROFILE_ACCEPTED:null,EVAVO_CODEX_SPARK_ACCEPTANCE_RECEIPT:null,EVAVO_CODEX_SPARK_CERTIFICATION_MODE:null,EVAVO_CODEX_CHATGPT_AUTH_POLICY_ACCEPTED:null});
  assert.equal(result.status, 1);
  let receipt = JSON.parse(result.stderr);
  assert.equal(receipt.started, false);
  assert.ok(receipt.errors.some((entry) => entry.includes("EXECUTION_ENABLED")));
  assert.ok(receipt.errors.some((entry) => entry.includes("ACCEPTANCE_RECEIPT")));

  result = run({EVAVO_CODEX_SPARK_EXECUTION_ENABLED:"1",EVAVO_CODEX_SPARK_PROFILE_ACCEPTED:"1",EVAVO_CODEX_SPARK_ACCEPTANCE_RECEIPT:null,EVAVO_CODEX_SPARK_CERTIFICATION_MODE:null,EVAVO_CODEX_CHATGPT_AUTH_POLICY_ACCEPTED:null});
  assert.equal(result.status, 1);
  receipt = JSON.parse(result.stderr);
  assert.equal(receipt.legacyProfileFlagPresent, true);
  assert.equal(receipt.supervisedPhysicalAcceptanceVerified, false);
  assert.ok(receipt.errors.some((entry) => entry.includes("legacy PROFILE_ACCEPTED boolean is not authority")));

  result = run({EVAVO_CODEX_SPARK_EXECUTION_ENABLED:"1",EVAVO_CODEX_SPARK_PROFILE_ACCEPTED:null,EVAVO_CODEX_SPARK_ACCEPTANCE_RECEIPT:path.join(dir,"missing-acceptance.json"),EVAVO_CODEX_SPARK_CERTIFICATION_MODE:null,EVAVO_CODEX_CHATGPT_AUTH_POLICY_ACCEPTED:null});
  assert.equal(result.status, 1);
  receipt = JSON.parse(result.stderr);
  assert.equal(receipt.supervisedPhysicalAcceptanceVerified, false);
  assert.ok(receipt.errors.some((entry) => entry.includes("ENOENT") || entry.includes("acceptance")));

  result = run({EVAVO_CODEX_SPARK_EXECUTION_ENABLED:"1",EVAVO_CODEX_SPARK_PROFILE_ACCEPTED:null,EVAVO_CODEX_SPARK_ACCEPTANCE_RECEIPT:null,EVAVO_CODEX_SPARK_CERTIFICATION_MODE:"1",EVAVO_CODEX_CHATGPT_AUTH_POLICY_ACCEPTED:"1"},{fixtureOnly:false});
  assert.equal(result.status, 1);
  receipt = JSON.parse(result.stderr);
  assert.ok(receipt.errors.some((entry) => entry.includes("fixtureOnly")));

  result = run({EVAVO_CODEX_SPARK_EXECUTION_ENABLED:"1",EVAVO_CODEX_SPARK_PROFILE_ACCEPTED:null,EVAVO_CODEX_SPARK_ACCEPTANCE_RECEIPT:null,EVAVO_CODEX_SPARK_CERTIFICATION_MODE:"1",EVAVO_CODEX_CHATGPT_AUTH_POLICY_ACCEPTED:null},{fixtureOnly:true});
  assert.equal(result.status, 1);
  receipt = JSON.parse(result.stderr);
  assert.ok(receipt.errors.some((entry) => entry.includes("AUTH_POLICY_ACCEPTED")));

  console.log("Codex worker runner safety tests passed.");
  console.log("- normal execution requires a supervised physical-acceptance envelope verified against the same fresh capability receipt");
  console.log("- a raw/missing acceptance and the legacy PROFILE_ACCEPTED boolean cannot authorize a model turn");
  console.log("- certification mode cannot admit non-fixture work and still requires positive ChatGPT-auth policy evidence");
  console.log("- no Codex executable or model turn is needed to prove these default-deny boundaries");
} finally {
  fs.rmSync(dir, {recursive:true, force:true});
}
