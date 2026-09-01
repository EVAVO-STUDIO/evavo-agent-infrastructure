#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  bindCodexWorkerDispatch,
  canonicalJson,
  sha256Bytes,
} from "./codex-worker-dispatch-binding-core.mjs";

const SOURCE = "a".repeat(40);
const bytes = (value) => Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
const digest = (value) => sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));

function fixture() {
  const workItem = {
    schemaVersion: 1,
    kind: "evavo-autonomous-work-item-v1",
    id: "work:bound-dispatch-fixture",
    lifecycleState: "LEASED",
    workerClass: "test-generation",
    repository: "EVAVO-STUDIO/example",
    sourceRevision: SOURCE,
    allowedPaths: ["tests/**"],
    forbiddenPaths: ["tests/fixtures/secrets/**"],
    requiredValidation: [{ executable: "node", argv: ["scripts/test-example.mjs"] }],
    paidFallbackAllowed: false,
  };
  const routeBody = {
    schemaVersion: 1,
    kind: "evavo-worker-route-plan-v1",
    eligible: true,
    decision: "DISPATCH_ELIGIBLE",
    workerClass: "test-generation",
    repository: workItem.repository,
    sourceRevision: SOURCE,
    routeId: "codex-spark-pro",
    paidFallbackUsed: false,
    executionPerformed: false,
    validationPerformed: false,
    publicationPerformed: false,
  };
  const routePlan = { ...routeBody, routePlanSha256: digest(routeBody) };
  const legacyBody = {
    schemaVersion: 1,
    kind: "evavo-codex-worker-dispatch-plan-v1",
    eligible: true,
    workerId: "spark-test-builder-fixture",
    workItemId: workItem.id,
    workerClass: workItem.workerClass,
    repository: workItem.repository,
    sourceRevision: SOURCE,
    routeId: "codex-spark-pro",
    routePlanSha256: routePlan.routePlanSha256,
    routePlanBytesSha256: sha256Bytes(bytes(routePlan)),
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    publicationAuthority: false,
    validationAuthority: false,
    paidFallbackUsed: false,
  };
  const legacyDispatchPlan = { ...legacyBody, dispatchPlanSha256: digest(legacyBody) };
  return { workItem, routePlan, legacyDispatchPlan };
}

function bind(value = fixture()) {
  return bindCodexWorkerDispatch({
    workItem: value.workItem,
    workItemBytes: bytes(value.workItem),
    routePlan: value.routePlan,
    routePlanBytes: bytes(value.routePlan),
    legacyDispatchPlan: value.legacyDispatchPlan,
  });
}

{
  const source = fixture();
  const result = bind(source);
  assert.equal(result.kind, "evavo-codex-worker-dispatch-plan-v1");
  assert.equal(result.dispatchBindingVersion, 1);
  assert.equal(result.legacyDispatchPlanSha256, source.legacyDispatchPlan.dispatchPlanSha256);
  assert.equal(result.workItemBytesSha256, sha256Bytes(bytes(source.workItem)));
  assert.equal(result.allowedPathsSha256, digest(source.workItem.allowedPaths));
  assert.equal(result.forbiddenPathsSha256, digest(source.workItem.forbiddenPaths));
  assert.equal(result.requiredValidationSha256, digest(source.workItem.requiredValidation));
  assert.notEqual(result.dispatchPlanSha256, source.legacyDispatchPlan.dispatchPlanSha256);
  const body = { ...result };
  delete body.dispatchPlanSha256;
  assert.equal(result.dispatchPlanSha256, digest(body));
  assert.equal(result.validationAuthority, false);
  assert.equal(result.publicationAuthority, false);
  assert.equal(result.paidFallbackUsed, false);
}

{
  const source = fixture();
  source.workItem.objective = "bytes changed after legacy compilation";
  const result = bind(source);
  assert.equal(result.workItemBytesSha256, sha256Bytes(bytes(source.workItem)));
  assert.notEqual(result.dispatchPlanSha256, source.legacyDispatchPlan.dispatchPlanSha256);
}

{
  const source = fixture();
  source.routePlan.repository = "EVAVO-STUDIO/other";
  const body = { ...source.routePlan };
  delete body.routePlanSha256;
  source.routePlan.routePlanSha256 = digest(body);
  assert.throws(() => bind(source), /identity differs/);
}

{
  const source = fixture();
  source.legacyDispatchPlan.routePlanBytesSha256 = "f".repeat(64);
  const body = { ...source.legacyDispatchPlan };
  delete body.dispatchPlanSha256;
  source.legacyDispatchPlan.dispatchPlanSha256 = digest(body);
  assert.throws(() => bind(source), /route-plan byte identity differs/);
}

{
  const source = fixture();
  source.legacyDispatchPlan.validationAuthority = true;
  const body = { ...source.legacyDispatchPlan };
  delete body.dispatchPlanSha256;
  source.legacyDispatchPlan.dispatchPlanSha256 = digest(body);
  assert.throws(() => bind(source), /authority boundary/);
}

{
  const first = bind();
  const second = bind();
  assert.equal(first.dispatchPlanSha256, second.dispatchPlanSha256);
  const source = fixture();
  source.workItem.requiredValidation.push({ task: "repository-test-suite" });
  const changed = bind(source);
  assert.notEqual(first.requiredValidationSha256, changed.requiredValidationSha256);
  assert.notEqual(first.dispatchPlanSha256, changed.dispatchPlanSha256);
}

console.log("Codex worker dispatch binding tests passed.");
console.log("- the final dispatch digest binds exact leased-work and route-plan bytes");
console.log("- allowed paths, forbidden paths and deterministic-validation requests are canonical digest identities");
console.log("- authority expansion, route drift and route-byte drift fail closed");
