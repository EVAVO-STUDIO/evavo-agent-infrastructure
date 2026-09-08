#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const source = process.argv[2];
if (!source) {
  console.error("Usage: node scripts/classify-codex-worker-result.mjs <codex-run-result.json>");
  process.exit(2);
}

const input = JSON.parse(fs.readFileSync(path.resolve(source), "utf8"));
const exitCode = Number.isInteger(input.exitCode) ? input.exitCode : null;
const verifiedCompletion = exitCode === 0 && input.modelTurnCompleted === true;
const textValue = (value) => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.text === "string") return value.text;
  return "";
};
const text = [textValue(input.stderr), textValue(input.stdout), textValue(input.error), textValue(input.message)]
  .filter(Boolean)
  .join("\n")
  .toLowerCase();

const patterns = {
  auth: [
    /not authenticated/,
    /authentication required/,
    /sign in to codex/,
    /login required/,
    /unauthorized/,
  ],
  exhausted: [
    /usage limit/,
    /weekly limit[^\n]*(?:reached|exhausted|0% left)/,
    /quota[^\n]*(?:exhausted|reached)/,
    /allowance[^\n]*(?:exhausted|reached)/,
  ],
  rateLimited: [
    /rate limit/,
    /too many requests/,
    /temporarily throttled/,
    /retry after/,
  ],
};

const matches = (list) => list.some((pattern) => pattern.test(text));
let capacityState;
let workDecision;
let category;

// A verified successful process/protocol completion is authoritative. Output from
// successful work can legitimately discuss quotas, authentication, or rate limits
// as subject matter and must not be reclassified as a runtime failure by text alone.
if (verifiedCompletion) {
  capacityState = "AVAILABLE";
  workDecision = "PROCESS_WORKER_RESULT";
  category = "completed-model-turn";
} else if (matches(patterns.auth)) {
  capacityState = "AUTH_REQUIRED";
  workDecision = "RETAIN_READY_JOB";
  category = "authentication";
} else if (matches(patterns.exhausted)) {
  capacityState = "EXHAUSTED";
  workDecision = "RETAIN_READY_JOB";
  category = "included-capacity-exhausted";
} else if (matches(patterns.rateLimited)) {
  capacityState = "RATE_LIMITED";
  workDecision = "BACKOFF_RETAIN_READY_JOB";
  category = "rate-limit";
} else if (exitCode === null) {
  capacityState = "OFFLINE";
  workDecision = "RETAIN_READY_JOB";
  category = "missing-runtime-result";
} else {
  capacityState = "DEGRADED";
  workDecision = "REVIEW_RUNTIME_FAILURE";
  category = "unclassified-runtime-failure";
}

const resetMatch = verifiedCompletion
  ? null
  : text.match(/(?:reset(?:s| time)?|try again after)\s*[: ]\s*([^\n,.]+)/i);

console.log(JSON.stringify({
  schemaVersion: 2,
  kind: "evavo-codex-worker-result-classification-v2",
  routeId: input.routeId ?? "codex-spark-pro",
  capacityState,
  category,
  workDecision,
  observedResetHint: resetMatch?.[1]?.trim() ?? null,
  paidFallbackAllowed: false,
  paidFallbackUsed: false,
  exactUsageRemainingKnown: false,
  sourceExitCode: exitCode,
  sourceModelTurnCompletedClaim: input.modelTurnCompleted === true,
  structuredTurnCompleted: verifiedCompletion,
  completionEvidenceConsistent: verifiedCompletion || input.modelTurnCompleted !== true,
  truthBoundary: "This classifier trusts completion only when the supplied runtime exit code is zero and the runtime receipt claims modelTurnCompleted=true. Error-like text is diagnostic evidence only for non-completed runs; it cannot override a verified successful completion. The classifier does not query or estimate remaining ChatGPT/Codex allowance and never authorizes paid fallback."
}, null, 2));
