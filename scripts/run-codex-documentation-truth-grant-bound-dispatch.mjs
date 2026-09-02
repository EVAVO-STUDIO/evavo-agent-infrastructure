#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBoundRunReceipt, validateGrantBoundDispatchPlan } from "./documentation-truth-grant-bound-dispatch-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function readJsonBytes(input, label, maximum) {
  const resolved = fs.realpathSync.native(path.resolve(input));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximum) throw new Error(`${label} must be a bounded regular non-symlink file.`);
  const bytes = fs.readFileSync(resolved);
  let document;
  try { document = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`${label} is not valid UTF-8 JSON.`); }
  if (!OBJECT(document)) throw new Error(`${label} must contain an object.`);
  return { resolved, bytes, document };
}
function owned(relative, label, maximum) {
  const source = readJsonBytes(path.join(ROOT, relative), label, maximum);
  const relation = path.relative(ROOT, source.resolved);
  if (relation.startsWith("..") || path.isAbsolute(relation)) throw new Error(`${label} escaped Agent Infrastructure.`);
  return source;
}

try {
  const inputs = process.argv.slice(2);
  if (inputs.length !== 3) throw new Error("Usage: node scripts/run-codex-documentation-truth-grant-bound-dispatch.mjs <grant-bound-dispatch-plan.json> <fresh-capability.json> <lease-effect-receipt.json>");
  const [planInput, capabilityInput, leaseInput] = inputs;
  const policy = owned("config/codex-documentation-truth-grant-bound-dispatch-v1.json", "grant-bound dispatch policy", 1024 * 1024).document;
  if (policy.schemaVersion !== 1 || policy.kind !== "evavo-codex-documentation-truth-grant-bound-dispatch-policy-v1") throw new Error("grant-bound dispatch policy identity is invalid.");
  for (const field of ["modelExecutionAuthority", "deterministicValidationAuthority", "repositoryMutationAuthority", "commitAuthority", "pushAuthority", "publicationAuthority", "deploymentAuthority", "financialActionAuthority", "paidFallbackAllowed"]) if (policy[field] !== false) throw new Error(`grant-bound runner policy must keep ${field}=false.`);
  const planSource = readJsonBytes(planInput, "grant-bound dispatch plan", policy.maximumInputBytes);
  const leaseSource = readJsonBytes(leaseInput, "grant-bound lease effect receipt", policy.maximumInputBytes);
  const capabilitySource = readJsonBytes(capabilityInput, "fresh Codex capability receipt", policy.maximumInputBytes);
  validateGrantBoundDispatchPlan({
    plan: planSource.document,
    planBytes: planSource.bytes,
    leaseReceipt: leaseSource.document,
    leaseReceiptBytes: leaseSource.bytes,
    policy
  });
  const baseRunner = path.join(ROOT, policy.baseRunner);
  const stat = fs.lstatSync(baseRunner);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("base documentation-truth runner is unavailable or unsafe.");
  const result = spawnSync(process.execPath, [baseRunner, planSource.resolved, capabilitySource.resolved], {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: policy.runnerTimeoutSeconds * 1000,
    maxBuffer: policy.maximumOutputBytes,
    env: process.env,
    stdin: "ignore"
  });
  if (result.error) throw result.error;
  const channel = result.status === 0 ? result.stdout : result.stderr || result.stdout;
  let runReceipt;
  try { runReceipt = JSON.parse(String(channel).trim()); }
  catch { throw new Error("base documentation-truth runner did not return JSON."); }
  if (result.status !== 0) {
    process.stderr.write(`${JSON.stringify(runReceipt, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    validateBoundRunReceipt({
      runReceipt,
      runReceiptBytes: Buffer.from(String(result.stdout), "utf8"),
      plan: planSource.document,
      planBytes: planSource.bytes,
      policy
    });
    process.stdout.write(String(result.stdout).endsWith("\n") ? String(result.stdout) : `${String(result.stdout)}\n`);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-grant-bound-run-error-v1",
    ok: false,
    started: false,
    errors: [String(error?.message ?? error).slice(0, 2000)],
    grantBoundLeaseVerified: false,
    modelTurnPerformed: false,
    candidateWorktreeMutationPerformed: false,
    primaryRepositoryMutationPerformed: false,
    deterministicValidationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    financialActionPerformed: false,
    paidFallbackUsed: false
  }, null, 2)}\n`);
  process.exitCode = 1;
}
