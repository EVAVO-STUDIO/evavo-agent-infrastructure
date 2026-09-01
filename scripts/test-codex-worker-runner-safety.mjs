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
  fs.writeFileSync(plan, JSON.stringify({
    kind:"evavo-codex-worker-dispatch-plan-v1",
    eligible:true,
    executable:"codex",
    publicationAuthority:false,
    validationAuthority:false,
    paidFallbackUsed:false,
    sandboxMode:"workspace-write",
    approvalPolicy:"never",
    argv:["exec","--json","--model","gpt-5.3-codex-spark","--sandbox","workspace-write","--ask-for-approval","never","-"],
    stdinPrompt:"fixture",
    workingDirectory:dir,
    sourceRevision:"a".repeat(40),
    workItemId:"work:fixture",
    workerId:"spark-fixture",
    repository:"EVAVO-STUDIO/example"
  }));
  fs.writeFileSync(capability, JSON.stringify({
    kind:"evavo-codex-worker-capability-probe-v1",
    eligibleForWorkerDispatch:true,
    observedAt:new Date().toISOString(),
    capabilities:{jsonFlag:"--json",modelFlag:"--model",sandboxFlag:"--sandbox",approvalFlag:"--ask-for-approval"}
  }));

  const env = {...process.env};
  delete env.EVAVO_CODEX_SPARK_EXECUTION_ENABLED;
  delete env.EVAVO_CODEX_SPARK_PROFILE_ACCEPTED;
  const result = spawnSync(process.execPath, ["scripts/run-codex-worker-dispatch.mjs", plan, capability], {
    encoding:"utf8", shell:false, env
  });
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stderr);
  assert.equal(receipt.started, false);
  assert.ok(receipt.errors.some((entry) => entry.includes("EXECUTION_ENABLED")));
  assert.ok(receipt.errors.some((entry) => entry.includes("PROFILE_ACCEPTED")));

  console.log("Codex worker runner safety tests passed.");
  console.log("- the effectful runner is disabled without both explicit runtime gates");
  console.log("- no Codex executable or model turn is needed to prove the default-deny boundary");
} finally {
  fs.rmSync(dir, {recursive:true, force:true});
}
