#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const developmentStudioInput = option("--development-studio-root");
const outputRootInput = option("--output-root");
if (!developmentStudioInput) {
  console.error("Usage: node scripts/certify-codex-spark-physical-acceptance.mjs --development-studio-root <dir> [--output-root <dir>]");
  process.exit(2);
}
if (process.env.EVAVO_CODEX_SPARK_CERTIFICATION_ENABLED !== "1") {
  console.error("Physical Spark certification requires EVAVO_CODEX_SPARK_CERTIFICATION_ENABLED=1.");
  process.exit(1);
}

function realDirectory(value, label) {
  const real = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(real);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real directory.`);
  return real;
}
function regularFile(root, relative, label) {
  const file = fs.realpathSync.native(path.join(root, relative));
  const rel = path.relative(root, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`${label} escaped its root.`);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  return file;
}
function run(executable, argv, options = {}) {
  const result = spawnSync(executable, argv, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding:"utf8",
    shell:false,
    windowsHide:true,
    input:options.input,
    timeout:options.timeout ?? 10 * 60_000,
    maxBuffer:options.maxBuffer ?? 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().slice(0,8192);
    throw new Error(`${options.label ?? executable} failed (${result.status}): ${text}`);
  }
  return String(result.stdout ?? "");
}
function runJson(executable, argv, options = {}) {
  return JSON.parse(run(executable, argv, options));
}
function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value,null,2)}\n`, {encoding:"utf8", flag:"wx", mode:0o600});
  return file;
}

const agentRoot = realDirectory(process.cwd(), "Agent Infrastructure root");
const devRoot = realDirectory(developmentStudioInput, "Development Studio root");
for (const [root, relative, label] of [
  [agentRoot,"scripts/probe-codex-worker-adapter.mjs","Codex capability probe"],
  [agentRoot,"scripts/probe-codex-chatgpt-auth-policy.mjs","Codex ChatGPT auth-policy probe"],
  [agentRoot,"scripts/plan-worker-route.mjs","Worker route planner"],
  [agentRoot,"scripts/compile-codex-worker-dispatch.mjs","Codex dispatch compiler"],
  [agentRoot,"scripts/run-codex-worker-dispatch.mjs","Codex worker runner"],
  [agentRoot,"scripts/classify-codex-worker-result.mjs","Codex result classifier"],
  [agentRoot,"scripts/validate-codex-spark-fixture.mjs","Spark fixture validator"],
  [agentRoot,"scripts/compile-codex-spark-physical-acceptance.mjs","Spark acceptance compiler"],
  [agentRoot,"scripts/verify-codex-spark-physical-acceptance.mjs","Spark acceptance verifier"],
  [devRoot,"scripts/prepare-autonomous-candidate-worktree.mjs","Candidate preparer"],
  [devRoot,"scripts/audit-autonomous-candidate-changes.mjs","Candidate auditor"],
  [devRoot,"scripts/reconcile-autonomous-worker-result.mjs","Worker reconciler"],
  [devRoot,"scripts/seal-autonomous-candidate-for-validation.mjs","Candidate sealer"],
  [devRoot,"scripts/attest-autonomous-primary-checkout-unchanged.mjs","Primary checkout attestor"],
  [devRoot,"scripts/remove-autonomous-candidate-worktree.mjs","Candidate cleanup"],
]) regularFile(root, relative, label);

const localState = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA,"EVAVO","AutonomousImprovement","SparkCertification")
  : path.join(os.tmpdir(),"EVAVO","AutonomousImprovement","SparkCertification");
const outputRoot = path.resolve(outputRootInput ?? localState);
fs.mkdirSync(outputRoot,{recursive:true,mode:0o700});
const runRoot = fs.mkdtempSync(path.join(outputRoot,"certification-"));
const fixtureRepo = path.join(runRoot,"fixture-repository");
const evidenceRoot = path.join(runRoot,"evidence");
fs.mkdirSync(fixtureRepo);
fs.mkdirSync(evidenceRoot);

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME:"EVAVO Spark Fixture",
  GIT_AUTHOR_EMAIL:"fixture@example.invalid",
  GIT_COMMITTER_NAME:"EVAVO Spark Fixture",
  GIT_COMMITTER_EMAIL:"fixture@example.invalid",
  GIT_TERMINAL_PROMPT:"0",
  GCM_INTERACTIVE:"Never",
};
const git = (argv, cwd = fixtureRepo) => execFileSync(process.platform === "win32" ? "git.exe" : "git", argv, {
  cwd, env:gitEnv, encoding:"utf8", shell:false, windowsHide:true, timeout:120000,
}).trim();

let validationCandidateReceipt = null;
let dirtyCandidateReceipt = null;
let terminalReceipt = null;
try {
  git(["init","-b","main"]);
  fs.mkdirSync(path.join(fixtureRepo,"src"));
  fs.mkdirSync(path.join(fixtureRepo,"tests"));
  fs.writeFileSync(path.join(fixtureRepo,"src","arithmetic.mjs"), "export function add(a, b) { return a + b; }\n");
  fs.writeFileSync(path.join(fixtureRepo,"README.md"), "# EVAVO disposable Spark certification fixture\n");
  git(["add","."]);
  git(["commit","-m","fixture base"]);
  const baseSha = git(["rev-parse","HEAD"]);

  const readyWork = {
    id:`work:spark-certification:${Date.now()}`,
    producer:"physical-certification",
    repository:"EVAVO-STUDIO/_autonomous-spark-fixture",
    kind:"test-gap",
    objective:"Add a focused Node test under tests/ that proves add(2, 3) returns 5 and add(-2, 2) returns 0 using node:test and node:assert/strict. Do not modify src/ or any other file.",
    sourceRevision:baseSha,
    lifecycleState:"READY",
    repoTier:"T0",
    repoLifecycleState:"EXPERIMENTAL",
    creativeProtection:"none",
    workClass:"test-expansion",
    workerClass:"test-generation",
    capacityClass:"included-consumer",
    paidFallbackAllowed:false,
    workerMayPublish:false,
    sourceMutationAllowed:true,
    fixtureOnly:true,
    maximumAutomaticAttempts:1,
    maximumChangedFiles:2,
    maximumChangedLines:100,
    allowedPaths:["tests"],
    forbiddenPaths:["src","README.md","package.json","pnpm-lock.yaml"],
    requiredValidation:["node --test"],
    qualityProfile:"maintenance-safe",
    impact:1,
    confidence:1,
    effort:1,
    regressionRisk:0,
    creativeRisk:0,
    compoundingValue:1,
    priorityScore:1,
  };
  const readyPath = writeJson(path.join(evidenceRoot,"01-work-ready.json"), readyWork);

  const capability = runJson(process.execPath,["scripts/probe-codex-worker-adapter.mjs"],{cwd:agentRoot,label:"Codex capability probe",timeout:60000});
  const capabilityPath = writeJson(path.join(evidenceRoot,"02-capability.json"), capability);
  const auth = runJson(process.execPath,["scripts/probe-codex-chatgpt-auth-policy.mjs"],{cwd:agentRoot,label:"ChatGPT auth-policy probe",timeout:60000});
  if (auth.accepted !== true) throw new Error("Codex ChatGPT-only auth policy is not proven; certification refuses to continue.");
  const authPath = writeJson(path.join(evidenceRoot,"03-auth-policy.json"), auth);

  const bootstrapCapacity = {schemaVersion:1,kind:"evavo-worker-capacity-status-v1",routes:[{routeId:"codex-spark-pro",state:"DEGRADED",maximumConcurrency:1,reason:"physical-certification-bootstrap-model-availability-not-yet-observed"}]};
  const bootstrapCapacityPath = writeJson(path.join(evidenceRoot,"04-bootstrap-capacity.json"), bootstrapCapacity);
  const route = runJson(process.execPath,["scripts/plan-worker-route.mjs",readyPath,bootstrapCapacityPath],{cwd:agentRoot,label:"Worker route plan"});
  if (route.eligible !== true || route.routeId !== "codex-spark-pro") throw new Error("Spark route is not eligible for fixture certification.");
  const routePath = writeJson(path.join(evidenceRoot,"05-route.json"),route);

  const workerId = `spark-cert-${process.pid}`;
  const leasedWork = {...readyWork,lifecycleState:"LEASED",lease:{workerId,leasedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30*60*1000).toISOString()}};
  const leasedPath = writeJson(path.join(evidenceRoot,"06-work-leased.json"),leasedWork);
  dirtyCandidateReceipt = runJson(process.execPath,[path.join(devRoot,"scripts","prepare-autonomous-candidate-worktree.mjs"),leasedPath,fixtureRepo],{cwd:devRoot,label:"Candidate preparation"});
  const candidatePath = writeJson(path.join(evidenceRoot,"07-candidate.json"),dirtyCandidateReceipt);

  const dispatch = runJson(process.execPath,["scripts/compile-codex-worker-dispatch.mjs",leasedPath,routePath,capabilityPath,candidatePath,workerId],{cwd:agentRoot,label:"Codex dispatch compilation"});
  const dispatchPath = writeJson(path.join(evidenceRoot,"08-dispatch.json"),dispatch);

  const runnerEnv = {...process.env,
    EVAVO_CODEX_SPARK_EXECUTION_ENABLED:"1",
    EVAVO_CODEX_SPARK_CERTIFICATION_MODE:"1",
    EVAVO_CODEX_CHATGPT_AUTH_POLICY_ACCEPTED:"1",
  };
  delete runnerEnv.EVAVO_CODEX_SPARK_PROFILE_ACCEPTED;
  const runReceipt = runJson(process.execPath,["scripts/run-codex-worker-dispatch.mjs",dispatchPath,capabilityPath],{cwd:agentRoot,label:"Spark fixture model turn",env:runnerEnv,timeout:20*60*1000,maxBuffer:16*1024*1024});
  const runPath = writeJson(path.join(evidenceRoot,"09-run.json"),runReceipt);
  const capacity = runJson(process.execPath,["scripts/classify-codex-worker-result.mjs",runPath],{cwd:agentRoot,label:"Spark capacity classification"});
  const capacityPath = writeJson(path.join(evidenceRoot,"10-capacity.json"),capacity);
  if (capacity.capacityState !== "AVAILABLE") throw new Error(`Spark fixture did not prove AVAILABLE capacity: ${capacity.capacityState}.`);

  const audit = runJson(process.execPath,[path.join(devRoot,"scripts","audit-autonomous-candidate-changes.mjs"),leasedPath,candidatePath],{cwd:devRoot,label:"Candidate audit"});
  const auditPath = writeJson(path.join(evidenceRoot,"11-audit.json"),audit);
  const runningWork = {...leasedWork,lifecycleState:"RUNNING",attempts:1};
  const runningPath = writeJson(path.join(evidenceRoot,"12-work-running.json"),runningWork);
  const reconciliation = runJson(process.execPath,[path.join(devRoot,"scripts","reconcile-autonomous-worker-result.mjs"),runningPath,runPath,capacityPath,auditPath],{cwd:devRoot,label:"Worker reconciliation"});
  if (reconciliation.nextLifecycleState !== "CANDIDATE_READY") throw new Error(`Fixture worker did not produce an admitted candidate: ${reconciliation.disposition}.`);
  const reconciliationPath = writeJson(path.join(evidenceRoot,"13-reconciliation.json"),reconciliation);

  const seal = runJson(process.execPath,[path.join(devRoot,"scripts","seal-autonomous-candidate-for-validation.mjs"),runningPath,candidatePath,auditPath,reconciliationPath],{cwd:devRoot,label:"Candidate sealing"});
  validationCandidateReceipt = seal;
  dirtyCandidateReceipt = null;
  const sealPath = writeJson(path.join(evidenceRoot,"14-seal.json"),seal);
  const validation = runJson(process.execPath,["scripts/validate-codex-spark-fixture.mjs",sealPath],{cwd:agentRoot,label:"Fixture validation"});
  const validationPath = writeJson(path.join(evidenceRoot,"15-validation.json"),validation);
  const primary = runJson(process.execPath,[path.join(devRoot,"scripts","attest-autonomous-primary-checkout-unchanged.mjs"),runningPath,fixtureRepo],{cwd:devRoot,label:"Primary checkout attestation"});
  const primaryPath = writeJson(path.join(evidenceRoot,"16-primary.json"),primary);

  const acceptance = runJson(process.execPath,[
    "scripts/compile-codex-spark-physical-acceptance.mjs",
    capabilityPath,authPath,leasedPath,candidatePath,runPath,capacityPath,auditPath,sealPath,validationPath,primaryPath
  ],{cwd:agentRoot,label:"Spark acceptance compilation"});
  const acceptancePath = writeJson(path.join(evidenceRoot,"17-acceptance.json"),acceptance);

  const freshCapability = runJson(process.execPath,["scripts/probe-codex-worker-adapter.mjs"],{cwd:agentRoot,label:"Fresh Codex capability probe",timeout:60000});
  const freshCapabilityPath = writeJson(path.join(evidenceRoot,"18-fresh-capability.json"),freshCapability);
  const verification = runJson(process.execPath,["scripts/verify-codex-spark-physical-acceptance.mjs",acceptancePath,freshCapabilityPath],{cwd:agentRoot,label:"Spark acceptance verification"});
  if (verification.accepted !== true) throw new Error("Compiled Spark physical acceptance did not verify.");
  const verificationPath = writeJson(path.join(evidenceRoot,"19-verification.json"),verification);

  const stableAcceptanceRoot = path.join(outputRoot,"accepted");
  fs.mkdirSync(stableAcceptanceRoot,{recursive:true,mode:0o700});
  const stableAcceptancePath = path.join(stableAcceptanceRoot,`acceptance-${Date.now()}.json`);
  fs.copyFileSync(acceptancePath,stableAcceptancePath,fs.constants.COPYFILE_EXCL);
  terminalReceipt = {
    schemaVersion:1,
    kind:"evavo-codex-spark-certification-run-v1",
    accepted:true,
    acceptedWorkerClasses:verification.workerClasses,
    maximumConcurrency:verification.maximumConcurrency,
    acceptancePath:stableAcceptancePath,
    evidenceDirectory:evidenceRoot,
    verificationPath,
    fixtureRepository:fixtureRepo,
    publicationPerformed:false,
    productRepositoryTouched:false,
    truthBoundary:"One disposable fixture model turn proved the initial Spark Test Builder path. The acceptance remains version-bound, temporary, concurrency-1, no-paid-fallback and grants no publication authority."
  };
  console.log(JSON.stringify(terminalReceipt,null,2));
} finally {
  if (validationCandidateReceipt?.validationCandidate?.path && fs.existsSync(validationCandidateReceipt.validationCandidate.path)) {
    try {
      const cleanupDecisionPath = path.join(evidenceRoot,"cleanup-validation-decision.json");
      const syntheticCandidate = {kind:"evavo-autonomous-candidate-worktree-v1",workItemId:"validation-cleanup",repository:"EVAVO-STUDIO/_autonomous-spark-fixture",sourceRevision:validationCandidateReceipt.commitSha,candidate:validationCandidateReceipt.validationCandidate};
      const syntheticWork = {id:"validation-cleanup",repository:"EVAVO-STUDIO/_autonomous-spark-fixture",sourceRevision:validationCandidateReceipt.commitSha};
      const workPath = path.join(evidenceRoot,"cleanup-work.json");
      const candidatePath = path.join(evidenceRoot,"cleanup-candidate.json");
      writeJson(workPath,syntheticWork);
      writeJson(candidatePath,syntheticCandidate);
      writeJson(cleanupDecisionPath,{kind:"evavo-autonomous-worker-reconciliation-v1",workItemId:"validation-cleanup",repository:"EVAVO-STUDIO/_autonomous-spark-fixture",cleanupCandidate:true,nextLifecycleState:"VERIFIED_COMPLETE",disposition:"FIXTURE_CLEANUP"});
      run(process.execPath,[path.join(devRoot,"scripts","remove-autonomous-candidate-worktree.mjs"),workPath,candidatePath,cleanupDecisionPath],{cwd:devRoot,label:"Validation candidate cleanup"});
    } catch {}
  }
  if (dirtyCandidateReceipt?.candidate?.path && fs.existsSync(dirtyCandidateReceipt.candidate.path)) {
    try {
      execFileSync(process.platform === "win32" ? "git.exe" : "git",["-C",fixtureRepo,"worktree","remove","--force",dirtyCandidateReceipt.candidate.path],{env:gitEnv,stdio:"ignore",shell:false});
    } catch {}
  }
}
