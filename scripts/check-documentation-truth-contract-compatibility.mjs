#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  routePolicy: "config/documentation-truth-runtime-route-planner-v1.json",
  routeSchema: "schemas/documentation-truth-runtime-route-plan-v1.schema.json",
  leasePolicy: "config/documentation-truth-route-bound-lease-v2.json",
  routeCore: "scripts/documentation-truth-runtime-route-planner-core.mjs",
  manifest: "evavo.capabilities.json",
  package: "package.json",
};
const errors = [];

function read(relative) {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) {
    errors.push(`Required documentation-truth compatibility file is missing: ${relative}.`);
    return "";
  }
  const metadata = fs.lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    errors.push(`Required documentation-truth compatibility file is unsafe: ${relative}.`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}
function parse(relative) {
  const source = read(relative);
  try {
    return JSON.parse(source);
  } catch (error) {
    errors.push(`${relative} is invalid JSON: ${String(error?.message ?? error)}.`);
    return {};
  }
}
function requireValue(condition, message) {
  if (!condition) errors.push(message);
}
function exactArray(value, expected) {
  return Array.isArray(value) && JSON.stringify(value) === JSON.stringify(expected);
}
function exactSet(value, expected) {
  return Array.isArray(value) &&
    value.length === expected.length &&
    [...value].sort().every((entry, index) => entry === [...expected].sort()[index]);
}
function allFalse(value, fields, label) {
  for (const field of fields) {
    if (value?.[field] !== false) errors.push(`${label}.${field} must remain false.`);
  }
}

const routePolicy = parse(files.routePolicy);
const routeSchema = parse(files.routeSchema);
const leasePolicy = parse(files.leasePolicy);
const manifest = parse(files.manifest);
const packageDocument = parse(files.package);
const routeCore = read(files.routeCore);

const identity = {
  workerClass: "documentation-truth",
  workClass: "capability-manifest-maintenance",
  routeId: "codex-spark-pro",
  capacityClass: "included-consumer",
};

requireValue(
  routePolicy.schemaVersion === 1 &&
    routePolicy.kind === "evavo-documentation-truth-runtime-route-planner-policy-v1" &&
    routePolicy.owner === "EVAVO-STUDIO/evavo-agent-infrastructure",
  "Documentation-truth runtime route policy identity is invalid.",
);
for (const [field, expected] of Object.entries(identity)) {
  requireValue(routePolicy[field] === expected, `Runtime route policy ${field} drifted.`);
}
requireValue(routePolicy.modelPreference === "gpt-5.3-codex-spark", "Runtime route model preference drifted.");
requireValue(routePolicy.maximumConcurrency === 1, "Runtime route maximum concurrency must remain one.");
requireValue(routePolicy.paidFallbackAllowed === false, "Runtime route paid fallback must remain disabled.");
requireValue(
  routePolicy.requiredGrantVerification?.kind ===
    "evavo-local-storage-documentation-truth-runtime-grant-verification-v1",
  "Runtime route policy must pin the exact Local Storage v3 grant-verification kind.",
);
requireValue(routePolicy.requiredGrantVerification?.clientPolicyVersion === 3, "Runtime route policy must require Local Storage client policy v3.");
for (const field of [
  "pathSafetyVerified",
  "parentComponentSymlinkSafetyVerified",
  "exactRequestIdentityVerified",
]) {
  requireValue(routePolicy.requiredGrantVerification?.[field] === true, `Runtime route grant boundary must require ${field}=true.`);
}
for (const field of ["grantConsumed", "leaseAcquired", "modelTurnPerformed"]) {
  requireValue(routePolicy.requiredGrantVerification?.[field] === false, `Runtime route grant boundary must require ${field}=false.`);
}
requireValue(
  routePolicy.requiredCapacityAdmission?.kind ===
    "evavo-documentation-truth-runtime-capacity-admission-v1",
  "Runtime route policy must pin the exact capacity-admission kind.",
);
requireValue(routePolicy.requiredCapacityAdmission?.decision === "ADMITTED", "Runtime route policy must require ADMITTED capacity.");
requireValue(exactArray(routePolicy.requiredCapacityAdmission?.admittedWorkerClasses, ["documentation-truth"]), "Runtime route policy must admit only documentation-truth.");
for (const value of Object.values(routePolicy.physicalRegistration ?? {})) {
  requireValue(value === false, "Runtime route physical registration must remain entirely false.");
}
for (const value of Object.values(routePolicy.authority ?? {})) {
  requireValue(value === false, "Runtime route authority must remain entirely false.");
}

requireValue(
  routeSchema.$schema === "https://json-schema.org/draft/2020-12/schema" &&
    routeSchema.type === "object" &&
    routeSchema.additionalProperties === false,
  "Documentation-truth runtime route schema must remain a closed Draft 2020-12 object.",
);
const routeProperties = routeSchema.properties ?? {};
for (const [field, expected] of Object.entries({
  schemaVersion: 1,
  kind: "evavo-documentation-truth-runtime-route-plan-v1",
  eligible: true,
  decision: "DISPATCH_ELIGIBLE",
  workerClass: identity.workerClass,
  workClass: identity.workClass,
  routeId: identity.routeId,
  capacityClass: identity.capacityClass,
  maximumConcurrency: 1,
  paidFallbackUsed: false,
  executionPerformed: false,
  queueMutationPerformed: false,
  leaseAcquired: false,
  modelTurnPerformed: false,
  repositoryMutationPerformed: false,
  publicationPerformed: false,
})) {
  requireValue(routeProperties[field]?.const === expected, `Runtime route schema must require ${field}=${JSON.stringify(expected)}.`);
}
for (const field of [
  "workItemId",
  "workItemSha256",
  "repository",
  "sourceRevision",
  "grantId",
  "grantBodySha256",
  "requestSha256",
  "agentInfrastructureMainSha",
  "localStorageMainSha",
  "capacityStatusSha256",
  "routeAdmissionSha256",
  "routePlanSha256",
]) {
  requireValue(routeSchema.required?.includes(field) === true, `Runtime route schema must require continuity field ${field}.`);
}
for (const token of [
  'value.kind !== "evavo-local-storage-documentation-truth-runtime-grant-verification-v1"',
  'kind: "evavo-documentation-truth-runtime-route-plan-v1"',
  'decision: "DISPATCH_ELIGIBLE"',
  'same(grant.workItemId, work.id, "Grant work-item id")',
  'same(grant.targetRepository, work.repository, "Grant target repository")',
  'same(grant.targetSourceRevision, work.sourceRevision, "Grant target source revision")',
  '"agentInfrastructureMainSha"',
  '"localStorageMainSha"',
  "grantConsumed",
  "leaseAcquired",
  "modelTurnPerformed",
  "repositoryMutationPerformed",
  "publicationPerformed",
]) {
  requireValue(routeCore.includes(token), `Runtime route core is missing compatibility boundary: ${token}.`);
}

requireValue(
  leasePolicy.schemaVersion === 2 &&
    leasePolicy.kind === "evavo-documentation-truth-route-bound-lease-policy-v2" &&
    leasePolicy.owner === "EVAVO-STUDIO/evavo-agent-infrastructure",
  "Documentation-truth route-bound lease policy identity is invalid.",
);
for (const [field, expected] of Object.entries(identity)) {
  requireValue(leasePolicy[field] === expected, `Route-bound lease policy ${field} drifted.`);
}
requireValue(leasePolicy.action === "storage.documentation_truth_work_exchange_lease", "Route-bound lease action must remain owned by Local Storage.");
requireValue(leasePolicy.routePlanKind === "evavo-worker-route-plan-v1", "Route-bound lease must continue to consume the exact worker-route plan contract.");
requireValue(leasePolicy.leasePlanKind === "evavo-documentation-truth-route-bound-lease-plan-v2", "Route-bound lease plan kind drifted.");
requireValue(leasePolicy.maximumConcurrency === 1 && leasePolicy.maximumAutomaticAttempts === 1, "Route-bound lease concurrency or attempt boundary drifted.");
requireValue(leasePolicy.maximumLeaseSeconds === 300, "Route-bound lease lifetime must remain at most 300 seconds.");
requireValue(leasePolicy.requireExactSnapshotDigest === true && leasePolicy.requireExpectedGeneration === true && leasePolicy.requireOneWriterPerRepository === true, "Route-bound lease exact-state or one-writer requirements drifted.");
allFalse(leasePolicy, [
  "paidFallbackAllowed",
  "queueMutationAuthority",
  "leaseAuthority",
  "modelAuthority",
  "repositoryMutationAuthority",
  "commitAuthority",
  "pushAuthority",
  "publicationAuthority",
  "deploymentAuthority",
  "financialAuthority",
], "Route-bound lease policy");

requireValue(manifest.contractVersion === "evavo_repository_capabilities_v1", "Agent capability manifest contract version is invalid.");
requireValue(manifest.repository === "EVAVO-STUDIO/evavo-agent-infrastructure", "Agent capability manifest repository identity is invalid.");
const runtimeCapability = manifest.capabilities?.find((entry) => entry.id === "agent.documentation-truth.runtime-route");
const leaseCapability = manifest.capabilities?.find((entry) => entry.id === "agent.documentation-truth.route-bound-lease-plan");
requireValue(exactSet(runtimeCapability?.effects, ["read", "compute"]), "Runtime-route capability must remain read/compute only.");
requireValue(exactArray(runtimeCapability?.entrypoints, [
  "scripts/plan-documentation-truth-runtime-route.mjs",
  "scripts/documentation-truth-runtime-route-planner-core.mjs",
  "config/documentation-truth-runtime-route-planner-v1.json",
]), "Runtime-route capability entrypoints drifted.");
requireValue(/Local Storage v3 grant-verification receipt/i.test(runtimeCapability?.description ?? ""), "Runtime-route capability must identify the exact Local Storage receipt family.");
requireValue(/grants no queue, lease, model, repository, Git, publication, deployment, financial or paid-fallback authority/i.test(runtimeCapability?.description ?? ""), "Runtime-route capability authority boundary drifted.");
requireValue(exactSet(leaseCapability?.effects, ["read", "compute"]), "Route-bound lease capability must remain read/compute only.");
requireValue(exactArray(leaseCapability?.entrypoints, [
  "scripts/compile-documentation-truth-route-bound-lease-v2.mjs",
  "config/documentation-truth-route-bound-lease-v2.json",
  "scripts/check-documentation-truth-route-bound-lease-v2.mjs",
]), "Route-bound lease capability entrypoints drifted.");
requireValue(/\bit is not a lease\b/i.test(leaseCapability?.description ?? ""), "Route-bound lease capability must state that planning is not a lease.");
requireValue(/Local Storage.*canonical exclusive lock/i.test(leaseCapability?.description ?? ""), "Route-bound lease capability must preserve Local Storage lease ownership.");

const expectedReadinessChain = [
  "node scripts/check-documentation-truth-contract-compatibility.mjs",
  "node scripts/check-documentation-truth-supervised-fixture-acceptance-v2.mjs",
  "node scripts/check-documentation-truth-supervised-activation-v2.mjs",
  "node scripts/check-documentation-truth-runtime-route-planner-contract.mjs",
  "node scripts/check-documentation-truth-route-bound-lease-v2.mjs",
].join(" && ");
requireValue(
  packageDocument.scripts?.["check:spark-documentation-truth-readiness"] === expectedReadinessChain,
  "Package documentation-truth readiness chain is missing or reordered.",
);
requireValue(
  String(packageDocument.scripts?.["test:spark-governance"] ?? "").endsWith(
    "&& pnpm check:spark-documentation-truth-readiness",
  ),
  "Spark governance must execute the documentation-truth readiness chain last.",
);

if (errors.length) {
  console.error("Documentation-truth cross-repository contract compatibility failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Documentation-truth cross-repository contract compatibility passed.");
console.log("- Local Storage v3 grant verification, Agent runtime route and continuity fields are pinned exactly");
console.log("- runtime route admission and route-bound lease planning remain separate zero-effect contracts");
console.log("- Local Storage remains the sole canonical lease-effect owner");
console.log("- normal Spark governance runs fixture, activation, route and route-bound lease contract suites");
console.log("- model, repository, Git, publication, deployment, financial and paid-fallback authority remain absent");
