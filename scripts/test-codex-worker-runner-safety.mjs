#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const ordered = (value) => {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
};
const canonicalJson = (value) => JSON.stringify(ordered(value));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const withDigest = (body) => ({ ...body, dispatchPlanSha256: sha256(Buffer.from(canonicalJson(body), "utf8")) });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-codex-runner-safety-"));
try {
  const planPath = path.join(dir, "plan.json");
  const capabilityPath = path.join(dir, "capability.json");
  const acceptancePath = path.join(dir, "acceptance.json");
  const capability = {
    schemaVersion: 1,
    kind: "evavo-codex-worker-capability-probe-v1",
    eligibleForWorkerDispatch: true,
    observedAt: new Date(Date.now() - 15_000).toISOString(),
    version: "fixture",
    capabilities: {
      jsonFlag: "--json",
      modelFlag: "--model",
      sandboxFlag: "--sandbox",
      approvalFlag: "--ask-for-approval",
    },
  };
  const capabilityBytes = Buffer.from(`${JSON.stringify(capability, null, 2)}\n`, "utf8");
  fs.writeFileSync(capabilityPath, capabilityBytes);
  const acceptanceBytes = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-spark-safe-physical-acceptance-v1",
    supervisedAt: new Date(Date.now() - 60_000).toISOString(),
  }, null, 2)}\n`, "utf8");
  fs.writeFileSync(acceptancePath, acceptanceBytes);

  const makePlanBody = (patch = {}) => ({
    schemaVersion: 1,
    kind: "evavo-codex-worker-dispatch-plan-v1",
    eligible: true,
    workerId: "spark-test-builder-fixture",
    workItemId: "work:fixture",
    workerClass: "test-generation",
    repository: "EVAVO-STUDIO/example",
    sourceRevision: "a".repeat(40),
    fixtureOnly: false,
    routeId: "codex-spark-pro",
    runtime: "codex",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    rawCapacityState: "AVAILABLE",
    maximumConcurrency: 1,
    routePlanSha256: "1".repeat(64),
    routePlanBytesSha256: "2".repeat(64),
    capacityStatusSha256: "3".repeat(64),
    routeAdmissionSha256: "4".repeat(64),
    routeAdmissionObservedAt: new Date(Date.now() - 20_000).toISOString(),
    routeAdmissionExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    supervisedAcceptanceSha256: sha256(acceptanceBytes),
    capabilityReceiptSha256: sha256(capabilityBytes),
    capacityObservationSha256: "5".repeat(64),
    acceptanceVerificationSha256: "6".repeat(64),
    candidateReceiptSha256: "7".repeat(64),
    executable: "codex",
    argv: ["exec", "--json", "--model", "gpt-5.3-codex-spark", "--sandbox", "workspace-write", "--ask-for-approval", "never", "-"],
    stdinPrompt: "fixture",
    workingDirectory: dir,
    candidateContract: "evavo_mainline_candidate_worktree_v1",
    candidateTreeSha: null,
    shell: false,
    structuredOutputRequired: true,
    workerSummarySchemaVersion: 1,
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessExpected: true,
    apiKeyEnvironmentVariablesMustBeRemoved: ["OPENAI_API_KEY", "CODEX_API_KEY"],
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    publicationAuthority: false,
    validationAuthority: false,
    paidFallbackUsed: false,
    ...patch,
  });

  const controls = [
    "EVAVO_CODEX_SPARK_EXECUTION_ENABLED",
    "EVAVO_CODEX_SPARK_PROFILE_ACCEPTED",
    "EVAVO_CODEX_SPARK_ACCEPTANCE_RECEIPT",
    "EVAVO_CODEX_SPARK_CERTIFICATION_MODE",
    "EVAVO_CODEX_CHATGPT_AUTH_POLICY_ACCEPTED",
  ];
  const run = ({ envPatch = {}, planPatch = {}, mutatePlanAfterDigest = null, capabilityDocument = capability } = {}) => {
    const plan = withDigest(makePlanBody(planPatch));
    if (typeof mutatePlanAfterDigest === "function") mutatePlanAfterDigest(plan);
    fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    fs.writeFileSync(capabilityPath, `${JSON.stringify(capabilityDocument, null, 2)}\n`);
    const env = { ...process.env };
    for (const name of controls) delete env[name];
    for (const [name, value] of Object.entries(envPatch)) {
      if (value === null) delete env[name];
      else env[name] = value;
    }
    const result = spawnSync(process.execPath, ["scripts/run-codex-worker-dispatch.mjs", planPath, capabilityPath], {
      encoding: "utf8",
      shell: false,
      env,
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { result, receipt: JSON.parse(String(result.stderr || result.stdout).trim()) };
  };

  {
    const { result, receipt } = run();
    assert.equal(result.status, 1);
    assert.equal(receipt.started, false);
    assert.ok(receipt.errors.some((entry) => entry.includes("EXECUTION_ENABLED")));
    assert.equal(receipt.modelTurnPerformed, false);
  }

  {
    const { result, receipt } = run({
      envPatch: {
        EVAVO_CODEX_SPARK_EXECUTION_ENABLED: "1",
        EVAVO_CODEX_SPARK_PROFILE_ACCEPTED: "1",
      },
    });
    assert.equal(result.status, 1);
    assert.equal(receipt.legacyProfileFlagPresent, true);
    assert.equal(receipt.supervisedPhysicalAcceptanceVerified, false);
    assert.ok(receipt.errors.some((entry) => entry.includes("legacy PROFILE_ACCEPTED boolean is not authority")));
  }

  {
    const { result, receipt } = run({
      envPatch: { EVAVO_CODEX_SPARK_EXECUTION_ENABLED: "1" },
      mutatePlanAfterDigest: (plan) => { plan.rawCapacityState = "DEGRADED"; },
    });
    assert.equal(result.status, 1);
    assert.ok(receipt.errors.some((entry) => entry.includes("Dispatch-plan SHA-256")));
  }

  {
    const changedCapability = { ...capability, version: "changed-after-admission" };
    const { result, receipt } = run({
      envPatch: { EVAVO_CODEX_SPARK_EXECUTION_ENABLED: "1" },
      capabilityDocument: changedCapability,
    });
    assert.equal(result.status, 1);
    assert.ok(receipt.errors.some((entry) => entry.includes("Capability receipt bytes differ")));
  }

  {
    const { result, receipt } = run({
      envPatch: { EVAVO_CODEX_SPARK_EXECUTION_ENABLED: "1" },
      planPatch: {
        routeAdmissionObservedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        routeAdmissionExpiresAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      },
    });
    assert.equal(result.status, 1);
    assert.ok(receipt.errors.some((entry) => entry.includes("Route admission")));
  }

  {
    const { result, receipt } = run({
      envPatch: { EVAVO_CODEX_SPARK_EXECUTION_ENABLED: "1" },
      planPatch: { workerClass: "fast-coding" },
    });
    assert.equal(result.status, 1);
    assert.ok(receipt.errors.some((entry) => entry.includes("Test Builder worker class")));
  }

  {
    const { result, receipt } = run({
      envPatch: { EVAVO_CODEX_SPARK_EXECUTION_ENABLED: "1" },
      planPatch: { maximumConcurrency: 2 },
    });
    assert.equal(result.status, 1);
    assert.ok(receipt.errors.some((entry) => entry.includes("concurrency")));
  }

  {
    const { result, receipt } = run({
      envPatch: {
        EVAVO_CODEX_SPARK_EXECUTION_ENABLED: "1",
        EVAVO_CODEX_SPARK_ACCEPTANCE_RECEIPT: path.join(dir, "missing-acceptance.json"),
      },
    });
    assert.equal(result.status, 1);
    assert.equal(receipt.supervisedPhysicalAcceptanceVerified, false);
    assert.ok(receipt.errors.some((entry) => entry.includes("ENOENT") || entry.includes("acceptance")));
  }

  {
    const { result, receipt } = run({
      envPatch: {
        EVAVO_CODEX_SPARK_EXECUTION_ENABLED: "1",
        EVAVO_CODEX_SPARK_CERTIFICATION_MODE: "1",
        EVAVO_CODEX_CHATGPT_AUTH_POLICY_ACCEPTED: "1",
      },
      planPatch: { fixtureOnly: false },
    });
    assert.equal(result.status, 1);
    assert.ok(receipt.errors.some((entry) => entry.includes("dedicated fixture repository")));
  }

  {
    const { result, receipt } = run({
      envPatch: {
        EVAVO_CODEX_SPARK_EXECUTION_ENABLED: "1",
        EVAVO_CODEX_SPARK_CERTIFICATION_MODE: "1",
      },
      planPatch: {
        fixtureOnly: true,
        repository: "EVAVO-STUDIO/_autonomous-spark-fixture",
      },
    });
    assert.equal(result.status, 1);
    assert.ok(receipt.errors.some((entry) => entry.includes("AUTH_POLICY_ACCEPTED")));
  }

  {
    const { result, receipt } = run({
      envPatch: {
        EVAVO_CODEX_SPARK_EXECUTION_ENABLED: "1",
        EVAVO_CODEX_SPARK_ACCEPTANCE_RECEIPT: acceptancePath,
      },
      planPatch: { supervisedAcceptanceSha256: "8".repeat(64) },
    });
    assert.equal(result.status, 1);
    assert.ok(receipt.errors.some((entry) => entry.includes("acceptance bytes differ")));
  }

  console.log("Codex worker runner safety tests passed.");
  console.log("- canonical dispatch tampering, capability-byte drift and expired admission fail before process start");
  console.log("- worker-class and concurrency escalation remain rejected");
  console.log("- normal execution requires exact supervised-acceptance bytes; the legacy boolean is not authority");
  console.log("- certification mode remains restricted to its fixture and positive ChatGPT-auth policy evidence");
  console.log("- no Codex executable or model turn is needed to prove these default-deny boundaries");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
