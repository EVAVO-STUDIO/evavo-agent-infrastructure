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
const eligible = routes
  .map((route) => ({ route, status: statusByRoute.get(route.id) }))
  .filter(({ status }) => status && ["AVAILABLE", "DEGRADED"].includes(status.state));

if (errors.length) {
  console.error(JSON.stringify({ kind: "evavo-worker-route-plan-v1", eligible: false, errors }, null, 2));
  process.exit(1);
}

if (eligible.length === 0) {
  const matching = routes.map((route) => ({
    routeId: route.id,
    state: statusByRoute.get(route.id)?.state ?? "UNKNOWN",
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

console.log(JSON.stringify({
  kind: "evavo-worker-route-plan-v1",
  eligible: true,
  decision: "DISPATCH_ELIGIBLE",
  routeId: selected.route.id,
  runtime: selected.route.runtime,
  modelPreference: selected.route.modelPreference,
  capacityClass: selected.route.capacityClass,
  capacityState: selected.status.state,
  maximumAutomaticConcurrency: selected.status.maximumConcurrency ?? selected.route.maximumAutomaticConcurrency,
  paidFallbackUsed: false,
  executionPerformed: false,
  truthBoundary: "This is a route plan only. No model turn, repository effect, validation or publication has occurred."
}, null, 2));
