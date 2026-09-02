#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileGrantBoundDispatchPlan } from "./documentation-truth-grant-bound-dispatch-core.mjs";

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
function minimalEnvironment() {
  const values = {
    PATH: process.env.PATH ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    SYSTEMROOT: process.env.SYSTEMROOT ?? "",
    WINDIR: process.env.WINDIR ?? "",
    HOME: process.env.HOME ?? "",
    USERPROFILE: process.env.USERPROFILE ?? "",
    LOCALAPPDATA: process.env.LOCALAPPDATA ?? "",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    EVAVO_CODEX_SPARK_EXECUTION_ENABLED: "0",
    EVAVO_CODEX_DOCUMENTATION_TRUTH_EXECUTION_ENABLED: "0"
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""));
}
function parseArguments(argv) {
  if (argv.length !== 6 && argv.length !== 8) {
    throw new Error("Usage: node scripts/compile-codex-documentation-truth-grant-bound-dispatch.mjs <leased-work.json> <route-plan.json> <codex-capability.json> <candidate-receipt.json> <lease-effect-receipt.json> <worker-id> [--now <iso-8601>]");
  }
  const [work, route, capability, candidate, leaseReceipt, workerId, option, now] = argv;
  if (argv.length === 8 && option !== "--now") throw new Error("Only --now is accepted as an optional argument.");
  return { work, route, capability, candidate, leaseReceipt, workerId, now };
}

try {
  const input = parseArguments(process.argv.slice(2));
  const policy = owned("config/codex-documentation-truth-grant-bound-dispatch-v1.json", "grant-bound dispatch policy", 1024 * 1024).document;
  if (policy.schemaVersion !== 1 || policy.kind !== "evavo-codex-documentation-truth-grant-bound-dispatch-policy-v1") throw new Error("grant-bound dispatch policy identity is invalid.");
  for (const field of ["modelExecutionAuthority", "deterministicValidationAuthority", "repositoryMutationAuthority", "commitAuthority", "pushAuthority", "publicationAuthority", "deploymentAuthority", "financialActionAuthority", "paidFallbackAllowed"]) if (policy[field] !== false) throw new Error(`grant-bound compiler policy must keep ${field}=false.`);
  const workSource = readJsonBytes(input.work, "leased work item", policy.maximumInputBytes);
  const leaseSource = readJsonBytes(input.leaseReceipt, "grant-bound lease effect receipt", policy.maximumInputBytes);
  const baseCompiler = path.join(ROOT, policy.baseCompiler);
  const stat = fs.lstatSync(baseCompiler);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("base documentation-truth compiler is unavailable or unsafe.");
  const argumentsList = [baseCompiler, input.work, input.route, input.capability, input.candidate, input.workerId];
  if (input.now) argumentsList.push("--now", input.now);
  const result = spawnSync(process.execPath, argumentsList, {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: policy.compilerTimeoutSeconds * 1000,
    maxBuffer: policy.maximumOutputBytes,
    env: minimalEnvironment(),
    stdin: "ignore"
  });
  if (result.error) throw result.error;
  const channel = result.status === 0 ? result.stdout : result.stderr || result.stdout;
  let basePlan;
  try { basePlan = JSON.parse(String(channel).trim()); }
  catch { throw new Error("base documentation-truth compiler did not return JSON."); }
  if (result.status !== 0) throw new Error(String(basePlan.errors?.[0] ?? "base documentation-truth compilation failed").slice(0, 2000));
  const plan = compileGrantBoundDispatchPlan({
    basePlan,
    leaseReceipt: leaseSource.document,
    leaseReceiptBytes: leaseSource.bytes,
    work: workSource.document,
    workerId: input.workerId,
    policy
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-dispatch-plan-v1",
    eligible: false,
    errors: [String(error?.message ?? error).slice(0, 2000)],
    grantConsumedBeforeDispatch: false,
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
