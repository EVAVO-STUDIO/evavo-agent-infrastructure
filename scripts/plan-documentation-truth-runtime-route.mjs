#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { compileDocumentationTruthRuntimeRoutePlan } from "./documentation-truth-runtime-route-planner-core.mjs";

function safeRegularFile(value, label, maximumBytes = 8 * 1024 * 1024) {
  if (typeof value !== "string" || !value || value.includes("\0")) throw new Error(`${label} path is invalid.`);
  if (value.split(/[\\/]+/u).some((segment) => segment === "..")) {
    throw new Error(`${label} path may not contain parent traversal.`);
  }
  const absolute = path.resolve(value);
  const root = path.parse(absolute).root;
  const relative = path.relative(root, absolute);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const metadata = fs.lstatSync(current);
    if (metadata.isSymbolicLink()) throw new Error(`${label} path component must not be a symbolic link.`);
  }
  const metadata = fs.lstatSync(absolute);
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > maximumBytes) {
    throw new Error(`${label} must be a bounded regular file.`);
  }
  return absolute;
}

function readJson(value, label, maximumBytes) {
  const file = safeRegularFile(value, label, maximumBytes);
  const bytes = fs.readFileSync(file);
  let document;
  try { document = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`${label} is not valid UTF-8 JSON.`); }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`${label} must contain one JSON object.`);
  }
  return document;
}

function parseArguments(values) {
  const options = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || options.has(key)) {
      throw new Error(
        "Usage: node scripts/plan-documentation-truth-runtime-route.mjs --work-item <json> --grant-verification <json> --capacity-admission <json> --now <ISO-8601>",
      );
    }
    options.set(key, value);
  }
  for (const key of ["--work-item", "--grant-verification", "--capacity-admission", "--now"]) {
    if (!options.has(key)) throw new Error(`Missing required option ${key}.`);
  }
  const now = new Date(options.get("--now"));
  if (!Number.isFinite(now.getTime())) throw new Error("--now is invalid.");
  return { options, now };
}

try {
  const { options, now } = parseArguments(process.argv.slice(2));
  const result = compileDocumentationTruthRuntimeRoutePlan({
    workItem: readJson(options.get("--work-item"), "READY work item", 2 * 1024 * 1024),
    grantVerification: readJson(
      options.get("--grant-verification"),
      "Local Storage grant verification receipt",
      8 * 1024 * 1024,
    ),
    capacityAdmission: readJson(
      options.get("--capacity-admission"),
      "Documentation-truth capacity admission",
      8 * 1024 * 1024,
    ),
    now,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-documentation-truth-runtime-route-plan-error-v1",
    eligible: false,
    decision: "RETAIN_READY_JOB",
    errors: [String(error?.message ?? error).slice(0, 2000)],
    capacityObservationPerformed: false,
    physicalAcceptancePerformed: false,
    grantConsumed: false,
    queueMutationPerformed: false,
    leaseAcquired: false,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    financialActionPerformed: false,
    paidFallbackUsed: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}
