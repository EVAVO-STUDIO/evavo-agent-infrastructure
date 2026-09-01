#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  console.error("Usage: node scripts/compile-codex-spark-raw-capacity-observation.mjs <observed-receipt.json>");
  process.exit(2);
}

const MAX_INPUT_BYTES = 1024 * 1024;
const ROUTE_ID = "codex-spark-pro";
const MODEL = "gpt-5.3-codex-spark";
const CAPACITY_CLASS = "included-consumer";
const STATES = new Set(["AVAILABLE", "DEGRADED", "RATE_LIMITED", "EXHAUSTED", "AUTH_REQUIRED", "OFFLINE", "UNKNOWN"]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const resolved = fs.realpathSync.native(path.resolve(inputPath));
const stat = fs.lstatSync(resolved);
if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Observed capacity receipt must be a regular non-symlink file.");
if (stat.size < 2 || stat.size > MAX_INPUT_BYTES) throw new Error("Observed capacity receipt size is outside the bounded contract.");
const bytes = fs.readFileSync(resolved);
let source;
try {
  source = JSON.parse(bytes.toString("utf8"));
} catch {
  throw new Error("Observed capacity receipt must contain UTF-8 JSON.");
}
if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("Observed capacity receipt must contain one JSON object.");
if (source.paidFallbackUsed === true || source.paidFallbackAllowed === true) throw new Error("Paid-fallback evidence cannot become a raw Spark capacity observation.");
if (source.routeId !== undefined && source.routeId !== ROUTE_ID) throw new Error("Observed capacity receipt belongs to a different route.");
if (source.modelPreference !== undefined && source.modelPreference !== MODEL) throw new Error("Observed capacity receipt belongs to a different model.");
if (source.capacityClass !== undefined && source.capacityClass !== CAPACITY_CLASS) throw new Error("Observed capacity receipt belongs to a different capacity class.");

const sourceKind = String(source.kind ?? "");
let state = null;
let observationType = null;
let observedAt = source.observedAt ?? source.finishedAt ?? source.completedAt ?? source.recordedAt ?? null;
let maximumConcurrency = null;

if (sourceKind === "evavo-codex-worker-run-v1") {
  if (source.routeId !== ROUTE_ID) throw new Error("Codex worker run receipt is not the Spark route.");
  if (source.structuredTurnCompleted === true && source.modelTurnCompleted === true && source.exitCode === 0) {
    state = "AVAILABLE";
    observationType = "successful-spark-model-turn";
    maximumConcurrency = 1;
  } else {
    const explicit = source.capacityState ?? source.observedCapacityState ?? source.classification?.capacityState ?? null;
    if (typeof explicit === "string" && STATES.has(explicit)) {
      state = explicit;
      observationType = "explicit-capacity-state-on-worker-run";
    } else {
      throw new Error("A failed/incomplete worker run cannot infer capacity without an explicit classified capacity state.");
    }
  }
} else if (
  sourceKind === "evavo-codex-worker-result-classification-v1" ||
  sourceKind === "evavo-codex-worker-capacity-classification-v1" ||
  (sourceKind.includes("codex-worker") && sourceKind.includes("classification"))
) {
  const explicit = source.capacityState ?? source.state ?? source.classification?.capacityState ?? source.classification?.state ?? null;
  if (typeof explicit !== "string" || !STATES.has(explicit)) {
    throw new Error("Codex result classification lacks an admitted explicit capacity state.");
  }
  state = explicit;
  observationType = "explicit-result-classification";
  maximumConcurrency = Number.isInteger(source.maximumConcurrency) && source.maximumConcurrency > 0
    ? Math.min(source.maximumConcurrency, 64)
    : null;
} else if (sourceKind === "evavo-codex-spark-account-status-v1") {
  const explicit = source.capacityState ?? source.state ?? null;
  if (typeof explicit !== "string" || !STATES.has(explicit)) {
    throw new Error("Codex Spark account-status receipt lacks an admitted explicit capacity state.");
  }
  if (source.observedBy !== "official-codex-status" && source.observedBy !== "operator-reviewed-account-status") {
    throw new Error("Account-status capacity evidence has an unadmitted observation source.");
  }
  state = explicit;
  observationType = "explicit-account-status";
  maximumConcurrency = Number.isInteger(source.maximumConcurrency) && source.maximumConcurrency > 0
    ? Math.min(source.maximumConcurrency, 64)
    : null;
} else {
  throw new Error("Receipt kind cannot provide raw Spark capacity. Capability, authentication and physical-acceptance receipts are deliberately non-capacity evidence.");
}

const parsedTime = typeof observedAt === "string" ? Date.parse(observedAt) : Number.NaN;
if (!Number.isFinite(parsedTime)) throw new Error("Observed capacity receipt lacks a valid observation timestamp.");
if (parsedTime - Date.now() > 120_000) throw new Error("Observed capacity receipt is future-dated.");
if (!STATES.has(state)) throw new Error("Raw capacity state is invalid.");

const result = {
  schemaVersion: 1,
  kind: "evavo-codex-spark-raw-capacity-observation-v1",
  routeId: ROUTE_ID,
  modelPreference: MODEL,
  capacityClass: CAPACITY_CLASS,
  state,
  observedAt: new Date(parsedTime).toISOString(),
  source: sourceKind,
  observationType,
  evidenceClass: "observed-not-inferred",
  sourceReceiptSha256: sha256(bytes),
  sourceReceiptBytes: bytes.length,
  maximumConcurrency,
  paidFallbackAllowed: false,
  paidFallbackUsed: false,
  accountUsageQueriedByCompiler: false,
  capacityInferredFromTransport: false,
  capacityInferredFromAuthentication: false,
  capacityInferredFromPhysicalAcceptance: false,
  modelTurnPerformedByCompiler: false,
  repositoryMutationPerformed: false,
  publicationPerformed: false,
  truthBoundary:
    "This receipt normalizes only a successful Spark model turn or an explicit capacity classification/account-status observation. Codex installation, CLI flags, authentication policy and physical acceptance are intentionally rejected as capacity evidence.",
};
console.log(JSON.stringify(result, null, 2));
