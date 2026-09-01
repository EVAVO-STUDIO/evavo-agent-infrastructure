#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function read(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

const [workPath, routePath, capabilityPath, candidateReceiptPath, workerId] = process.argv.slice(2);
if (!workPath || !routePath || !capabilityPath || !candidateReceiptPath || !workerId) {
  console.error("Usage: node scripts/compile-codex-worker-dispatch.mjs <leased-work.json> <route-plan.json> <codex-capability.json> <candidate-receipt.json> <worker-id>");
  process.exit(2);
}

const work = read(workPath);
const route = read(routePath);
const capability = read(capabilityPath);
const candidateReceipt = read(candidateReceiptPath);
const adapter = read("config/codex-worker-adapter-v1.json");
const profile = read("config/worker-profiles/test-builder-v1.json");
const errors = [];

if (work.lifecycleState !== "LEASED") errors.push("Work item must be LEASED before dispatch compilation.");
if (work.lease?.workerId !== workerId) errors.push("Work item lease must belong to the requested worker id.");
if (work.workerClass !== profile.workerClass) errors.push(`Initial dispatcher only admits ${profile.workerClass}.`);
if (work.paidFallbackAllowed !== false) errors.push("Paid fallback must be false.");
if (route.eligible !== true || route.decision !== "DISPATCH_ELIGIBLE") errors.push("Route plan is not dispatch eligible.");
if (route.routeId !== adapter.spark.routeId) errors.push("Route plan is not the admitted Spark route.");
if (capability.eligibleForWorkerDispatch !== true) errors.push("Codex capability probe is not eligible for dispatch.");
for (const key of ["jsonFlag", "modelFlag", "sandboxFlag", "approvalFlag"]) {
  if (!capability.capabilities?.[key]) errors.push(`Codex capability receipt lacks ${key}.`);
}
if (!work.repository || !work.sourceRevision) errors.push("Work item requires repository and source revision.");
if (!Array.isArray(work.allowedPaths) || work.allowedPaths.length === 0) errors.push("Work item requires bounded allowed paths.");
if (!Array.isArray(work.requiredValidation) || work.requiredValidation.length === 0) errors.push("Work item requires deterministic validation steps.");
if (candidateReceipt.kind !== "evavo-autonomous-candidate-worktree-v1") errors.push("Candidate worktree receipt is invalid.");
if (candidateReceipt.workItemId !== work.id) errors.push("Candidate worktree receipt does not match the work item.");
if (candidateReceipt.sourceRevision !== work.sourceRevision) errors.push("Candidate worktree source revision does not match the work item.");
if (candidateReceipt.candidate?.contract !== "evavo_mainline_candidate_worktree_v1") errors.push("Candidate worktree contract is invalid.");

if (errors.length) {
  console.error(JSON.stringify({kind:"evavo-codex-worker-dispatch-plan-v1",eligible:false,errors}, null, 2));
  process.exit(1);
}

const allowed = work.allowedPaths.map((value) => `- ${value}`).join("\n");
const forbidden = (work.forbiddenPaths ?? []).map((value) => `- ${value}`).join("\n") || "- any path outside the allowed paths\n- production source unless explicitly listed as a test-support path\n- .git metadata";
const validation = work.requiredValidation.map((value) => `- ${typeof value === "string" ? value : JSON.stringify(value)}`).join("\n");
const prompt = `You are an EVAVO Test Builder worker. Complete exactly one bounded test-generation job.\n\nRepository: ${work.repository}\nExact source revision: ${work.sourceRevision}\nObjective: ${work.objective}\n\nAllowed paths:\n${allowed}\n\nForbidden paths:\n${forbidden}\n\nRequired downstream validation (do not claim these passed unless the external validator later supplies receipts):\n${validation}\n\nRules:\n- Add only meaningful regression, boundary, failure-path, or state-transition coverage required by the objective.\n- Do not redesign, refactor unrelated code, change dependencies, schemas, public APIs, creative assets, brand, story, art direction, or owner-authored copy.\n- Do not commit, push, publish, deploy, or change Git metadata.\n- Do not use the network, install dependencies, or alter machine/user configuration.\n- Do not broaden scope merely to consume model capacity. NO_ACTION is valid when coverage is already sufficient.\n- If production behavior is ambiguous or source changes would be required, return NEEDS_DEEP_WORKER or NEEDS_HUMAN rather than guessing.\n- Keep the patch bounded and leave deterministic validation to the EVAVO validation queue.\n\nAt the end, provide a concise structured summary containing resultState (SUCCESS, NO_ACTION, BLOCKED, NEEDS_DEEP_WORKER, or NEEDS_HUMAN), changedPaths, assertionsAdded, assumptions, and followUp.\n`;

const argv = [
  "exec",
  capability.capabilities.jsonFlag,
  capability.capabilities.modelFlag,
  route.modelPreference,
  capability.capabilities.sandboxFlag,
  adapter.dispatch.sandboxMode,
  capability.capabilities.approvalFlag,
  adapter.dispatch.approvalPolicy,
  "-"
];

console.log(JSON.stringify({
  schemaVersion: 1,
  kind: "evavo-codex-worker-dispatch-plan-v1",
  eligible: true,
  workerId,
  workItemId: work.id,
  repository: work.repository,
  sourceRevision: work.sourceRevision,
  executable: adapter.executable,
  argv,
  stdinPrompt: prompt,
  workingDirectory: candidateReceipt.candidate.path,
  candidateContract: candidateReceipt.candidate.contract,
  candidateTreeSha: candidateReceipt.sourceTreeSha,
  shell: false,
  structuredOutputRequired: true,
  sandboxMode: adapter.dispatch.sandboxMode,
  approvalPolicy: adapter.dispatch.approvalPolicy,
  networkAccessExpected: adapter.dispatch.networkAccessExpected,
  apiKeyEnvironmentVariablesMustBeRemoved: adapter.dispatch.apiKeyEnvironmentVariablesMustBeRemoved,
  modelTurnPerformed: false,
  repositoryMutationPerformed: false,
  publicationAuthority: false,
  validationAuthority: false,
  paidFallbackUsed: false,
  truthBoundary: "This plan compiles a bounded Codex Exec invocation inside an isolated candidate worktree but does not execute it. Runtime dispatch must recheck candidate identity, exact HEAD, clean pre-turn state, lease validity, capability freshness and route capacity."
}, null, 2));
