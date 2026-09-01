#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

const [workItemPath, capacityPath] = process.argv.slice(2);
if (!workItemPath || !capacityPath) {
  console.error("Usage: node scripts/plan-worker-route.mjs <work-item.json> <capacity-status.json>");
  process.exit(2);
}

const routing = readJson("config/worker-capacity-routing-v1.json");
const workItem = readJson(workItemPath);
const capacity = readJson(capacityPath);
const errors = [];

if (workItem.lifecycleState !== "READY") errors.push("Work item must be READY before route planning.");
if (!workItem.workerClass) errors.push("Work item requires workerClass.");
if (!workItem.capacityClass) errors.push("Work item requires capacityClass.");
if (workItem.paidFallbackAllowed !== false) errors.push("Spare-capacity work must explicitly disable paid fallback.");
if (!workItem.repository || !workItem.sourceRevision) errors.push("Work item requires repository and sourceRevision.");

const routes = (routing.workerRoutes ?? []).filter((route) =>
  (route.workerClasses ?? []).includes(workItem.workerClass) &&
  route.capacityClass === workItem.capacityClass &&
  route.paidFallbackAllowed === false,
);
const statusByRoute = new Map((capacity.routes ?? []).map((entry) => [entry.routeId, entry]));

function evaluatePhysicalAdmission(route, status) {
  if (route.physicalAdmissionRequired !== true) {
    return { eligible: true, admission: null, reason: null };
  }
  const admission = status?.physicalAdmission;
  if (!admission || admission.kind !== route.physicalAdmissionKind || admission.accepted !== true) {
    return { eligible: false, admission: null, reason: "PHYSICAL_ADMISSION_REQUIRED" };
  }
  if (admission.routeId !== route.id) {
    return { eligible: false, admission, reason: "PHYSICAL_ADMISSION_ROUTE_MISMATCH" };
  }
  if (!Array.isArray(admission.acceptedWorkerClasses) || !admission.acceptedWorkerClasses.includes(workItem.workerClass)) {
    return { eligible: false, admission, reason: "WORKER_CLASS_NOT_PHYSICALLY_ADMITTED" };
  }
  if (!Number.isInteger(admission.maximumConcurrency) || admission.maximumConcurrency < 1) {
    return { eligible: false, admission, reason: "PHYSICAL_ADMISSION_CONCURRENCY_INVALID" };
  }
  if (!/^[0-9a-f]{64}$/.test(String(admission.supervisedAcceptanceSha256 ?? ""))) {
    return { eligible: false, admission, reason: "PHYSICAL_ADMISSION_DIGEST_INVALID" };
  }
  const expiresAt = Date.parse(String(admission.expiresAt ?? ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return { eligible: false, admission, reason: "PHYSICAL_ADMISSION_EXPIRED" };
  }
  if (admission.providerApiCredentialsInherited !== false || admission.paidFallbackAllowed !== false || admission.publicationAuthority !== false) {
    return { eligible: false, admission, reason: "PHYSICAL_ADMISSION_AUTHORITY_INVALID" };
  }
  return { eligible: true, admission, reason: null };
}

const evaluated = routes.map((route) => {
  const status = statusByRoute.get(route.id);
  const admission = evaluatePhysicalAdmission(route, status);
  const capacityEligible = status && ["AVAILABLE", "DEGRADED"].includes(status.state);
  return { route, status, admission, eligible: Boolean(capacityEligible && admission.eligible) };
});
const eligible = evaluated.filter((entry) => entry.eligible);

if (errors.length) {
  console.error(JSON.stringify({ kind: "evavo-worker-route-plan-v1", eligible: false, errors }, null, 2));
  process.exit(1);
}

if (eligible.length === 0) {
  const matching = evaluated.map(({ route, status, admission }) => ({
    routeId: route.id,
    state: status?.state ?? "UNKNOWN",
    physicalAdmissionRequired: route.physicalAdmissionRequired === true,
    physicalAdmissionEligible: admission.eligible,
    physicalAdmissionReason: admission.reason,
  }));
  console.log(JSON.stringify({
    kind: "evavo-worker-route-plan-v1",
    eligible: false,
    decision: "RETAIN_READY_JOB",
    reason: "NO_ZERO_COST_CAPACITY_ROUTE_AVAILABLE",
    matchingRoutes: matching,
    paidFallbackUsed: false,
    executionPerformed: false,
  }, null, 2));
  process.exit(0);
}

eligible.sort((a, b) => {
  const stateRank = { AVAILABLE: 0, DEGRADED: 1 };
  return stateRank[a.status.state] - stateRank[b.status.state] || String(a.route.id).localeCompare(String(b.route.id));
});
const selected = eligible[0];
const concurrencyCandidates = [selected.route.maximumAutomaticConcurrency, selected.status.maximumConcurrency];
if (selected.admission.admission) concurrencyCandidates.push(selected.admission.admission.maximumConcurrency);
const maximumAutomaticConcurrency = Math.min(...concurrencyCandidates.filter((value) => Number.isInteger(value) && value > 0));

console.log(JSON.stringify({
  kind: "evavo-worker-route-plan-v1",
  eligible: true,
  decision: "DISPATCH_ELIGIBLE",
  routeId: selected.route.id,
  runtime: selected.route.runtime,
  modelPreference: selected.route.modelPreference,
  capacityClass: selected.route.capacityClass,
  capacityState: selected.status.state,
  physicalAdmissionRequired: selected.route.physicalAdmissionRequired === true,
  physicalAdmissionVerified: selected.admission.eligible,
  physicalAdmissionSha256: selected.admission.admission?.supervisedAcceptanceSha256 ?? null,
  maximumAutomaticConcurrency,
  paidFallbackUsed: false,
  executionPerformed: false,
  truthBoundary: "This is a route plan only. Capacity state cannot authorize a physically gated route without a fresh supervised admission for the exact worker class. No model turn, repository effect, validation or publication has occurred."
}, null, 2));
