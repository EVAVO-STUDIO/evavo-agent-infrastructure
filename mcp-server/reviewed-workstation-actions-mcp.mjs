import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

const PROTOCOL_VERSION = "2024-11-05";
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_ISSUE_BODY_BYTES = 256 * 1024;
const MAX_ISSUE_PUBLICATION_BYTES = MAX_ISSUE_BODY_BYTES + 16 * 1024;
const DEFAULT_WAIT_SECONDS = 3600;
const MAX_WAIT_SECONDS = 3900;
const DEFAULT_POLL_SECONDS = 5;
const IMAGE_PROOF_KIND = "evavo-local-image-smoke-proof-v3";
const IMAGE_PROOF_CONTRACT = "evavo-single-file-image-smoke-proof-v3";
const IMAGE_CHILD_RECEIPT_CONTRACT = "evavo-sha-bound-child-receipt-v1";
const HEX64 = /^[0-9a-f]{64}$/u;
const ACTIONS = Object.freeze([
  "resident-status",
  "image-smoke-cel-animation",
  "image-smoke-90s-game-art",
  "image-smoke-realistic",
]);

const TOOLS = Object.freeze([
  {
    name: "evavo_reviewed_workstation_actions",
    description: "List the fixed reviewed workstation actions available through the governed Local Compute queue. Performs no execution.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "evavo_reviewed_workstation_submit_and_wait",
    description: "Author one fixed reviewed workstation action through Local Compute, publish its exact SHA-bound GitHub queue issue, wait for the authoritative terminal receipt, and return correlated evidence. Callers cannot choose scripts, arguments, manifests, output paths, commands, network authority, or execution policy.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { enum: ACTIONS },
        waitSeconds: { type: "integer", minimum: 30, maximum: MAX_WAIT_SECONDS },
        pollSeconds: { type: "integer", minimum: 2, maximum: 30 },
      },
    },
  },
  {
    name: "evavo_reviewed_workstation_job_status",
    description: "Read one previously submitted reviewed workstation queue issue and return its latest authoritative terminal receipt without causing execution or replay.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["issueNumber"],
      properties: { issueNumber: { type: "integer", minimum: 1 } },
    },
  },
]);

function asObject(value, label = "value") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function localComputeRoot() {
  const configured = String(process.env.EVAVO_LOCAL_COMPUTE_ROOT || "").trim();
  return path.resolve(configured || path.join(process.cwd(), "..", "evavo-local-compute"));
}

function reviewedActionAuthor() {
  const root = localComputeRoot();
  const candidates = process.platform === "win32"
    ? [
        path.join(root, ".venv", "Scripts", "evavo-reviewed-workstation-actions.exe"),
        path.join(root, ".venv", "Scripts", "evavo-reviewed-workstation-actions"),
      ]
    : [path.join(root, ".venv", "bin", "evavo-reviewed-workstation-actions")];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const stat = statSync(candidate);
    if (stat.isFile()) return candidate;
  }
  throw new Error("Local Compute reviewed-workstation action author is unavailable in the managed .venv");
}

function runFile(executable, args, timeoutMs = 30_000, stdinText = null) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GH_PROMPT_DISABLED: "1" };
    delete env.GH_DEBUG;
    delete env.DEBUG;
    const child = execFile(
      executable,
      args,
      { windowsHide: true, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, env },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`governed subprocess failed: ${String(stderr || stdout || error.message).trim().slice(0, 3000)}`));
          return;
        }
        resolve(String(stdout || ""));
      },
    );
    if (stdinText === null) child.stdin?.end();
    else child.stdin?.end(String(stdinText), "utf8");
  });
}

async function runGh(args, timeoutMs = 30_000, stdinText = null) {
  return runFile(process.platform === "win32" ? "gh.exe" : "gh", args, timeoutMs, stdinText);
}

function parseObject(text, label) {
  let value;
  try {
    value = JSON.parse(String(text || "").trim());
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
  return asObject(value, label);
}

function parseJsonReceiptText(text) {
  if (typeof text !== "string") return null;
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/giu)];
  const candidates = fenced.length ? fenced.map((match) => match[1]) : [text];
  for (const candidate of candidates.reverse()) {
    try {
      const value = JSON.parse(candidate.trim());
      if (
        value && typeof value === "object" && !Array.isArray(value)
        && value.terminal === true
        && value.receiptIsOutcomeAuthority === true
      ) return value;
    } catch {}
  }
  return null;
}

function imageProofState(output) {
  if (typeof output !== "string" || !output.trim()) {
    return { claimed: false, valid: false, proof: null, reason: null };
  }
  const raw = output.trim();
  const markerClaimed = raw.includes(IMAGE_PROOF_KIND);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return {
      claimed: markerClaimed,
      valid: false,
      proof: null,
      reason: markerClaimed ? "image-proof-json-invalid" : null,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      claimed: markerClaimed,
      valid: false,
      proof: null,
      reason: markerClaimed ? "image-proof-object-invalid" : null,
    };
  }
  const claimed = value.kind === IMAGE_PROOF_KIND || markerClaimed;
  if (!claimed) return { claimed: false, valid: false, proof: null, reason: null };
  if (value.kind !== IMAGE_PROOF_KIND) {
    return { claimed: true, valid: false, proof: null, reason: "image-proof-kind-invalid" };
  }
  if (value.proofContract !== IMAGE_PROOF_CONTRACT) {
    return { claimed: true, valid: false, proof: null, reason: "image-proof-contract-invalid" };
  }
  if (value.receiptContract !== IMAGE_CHILD_RECEIPT_CONTRACT) {
    return { claimed: true, valid: false, proof: null, reason: "image-proof-child-receipt-contract-invalid" };
  }
  return { claimed: true, valid: true, proof: value, reason: null };
}

function imageProofCorrelation(receipt, proof) {
  if (!proof) return null;
  const outerJobId = String(receipt?.jobId ?? "");
  const outerScriptSha256 = String(receipt?.scriptSha256 ?? "").toLowerCase();
  const producerScriptSha256 = String(proof.producerScriptSha256 ?? "").toLowerCase();
  const outerJobIdMatches = Boolean(outerJobId) && proof.outerQueueJobId === outerJobId;
  const producerScriptSha256Matches = HEX64.test(outerScriptSha256)
    && HEX64.test(producerScriptSha256)
    && producerScriptSha256 === outerScriptSha256;
  const evidenceHashesPresent = [
    proof.manifestSha256,
    proof.requestSha256,
    proof.innerReceiptSha256,
    proof.batchReceiptSha256,
    proof.terminalReceiptSha256,
    proof.receiptDigestSha256,
  ].every((value) => HEX64.test(String(value ?? "").toLowerCase()));
  const proofAuthorityValid = proof.outerQueueJobIdentityBound === true
    && proof.singleFilePhysicalProof === true
    && proof.dynamicChildScriptLoaded === false
    && proof.gitSha1ChildDependency === false
    && proof.safeAutomaticReplay === false
    && proof.creativeApprovalGranted === false
    && proof.modelPromotionGranted === false
    && proof.publicationGranted === false
    && proof.repositoryMutationGranted === false;
  const technicalVerified = proof.technicalArtifactVerified === true && proof.postconditionVerified === true;
  const correlated = outerJobIdMatches
    && producerScriptSha256Matches
    && evidenceHashesPresent
    && proofAuthorityValid
    && technicalVerified;
  return {
    correlated,
    outerJobIdMatches,
    producerScriptSha256Matches,
    evidenceHashesPresent,
    proofAuthorityValid,
    technicalVerified,
    outerJobId,
    outerJobSha256: receipt?.jobSha256 ?? null,
    outerRequestSha256: receipt?.requestSha256 ?? null,
    producerScriptSha256: proof.producerScriptSha256 ?? null,
    manifestSha256: proof.manifestSha256 ?? null,
    innerRequestId: proof.requestId ?? null,
    innerRequestSha256: proof.requestSha256 ?? null,
    innerReceiptSha256: proof.innerReceiptSha256 ?? null,
    batchReceiptSha256: proof.batchReceiptSha256 ?? null,
    terminalReceiptSha256: proof.terminalReceiptSha256 ?? null,
    proofReceiptDigestSha256: proof.receiptDigestSha256 ?? null,
    physicalEffectState: proof.physicalEffectState ?? null,
    reconciliationRequired: proof.reconciliationRequired ?? null,
  };
}

function classifyReceipt(receipt, proofCorrelation = null, proofState = null) {
  if (!receipt) return "receipt-missing";
  if (proofState?.claimed === true && proofState.valid !== true) return proofState.reason || "image-proof-identity-invalid";
  if (proofCorrelation && proofCorrelation.correlated !== true) return "image-proof-correlation-failed";
  if (receipt.executionAttempted === false) return receipt.outcome === "blocked" ? "admission-or-policy" : "pre-execution";
  if (receipt.execution?.timedOut === true) return "timeout";
  if (Number.isInteger(receipt.execution?.exitCode) && receipt.execution.exitCode !== 0) return "process-exit";
  if (receipt.reconciliationRequired === true && receipt.sideEffectMayHaveCommitted === true) return "reconciliation-required";
  if (receipt.ok === true && receipt.status === "completed") return "none";
  return "unknown";
}

function normalizeReceipt(receipt, issueNumber) {
  const execution = receipt && typeof receipt.execution === "object" && receipt.execution ? receipt.execution : {};
  const proofState = imageProofState(receipt?.output);
  const imageProof = proofState.proof;
  const correlation = imageProofCorrelation(receipt, imageProof);
  const outerOk = receipt?.ok === true && receipt?.status === "completed";
  const imageProofRequired = proofState.claimed === true;
  const imageProofOk = !imageProofRequired || (proofState.valid === true && correlation?.correlated === true);
  return {
    schemaVersion: 2,
    kind: "evavo-reviewed-workstation-session-result-v2",
    ok: outerOk && imageProofOk,
    issueNumber,
    jobId: receipt?.jobId ?? null,
    jobSha256: receipt?.jobSha256 ?? null,
    scriptSha256: receipt?.scriptSha256 ?? null,
    requestSha256: receipt?.requestSha256 ?? null,
    terminal: receipt?.terminal === true,
    status: receipt?.status ?? null,
    outcome: receipt?.outcome ?? null,
    executionAttempted: receipt?.executionAttempted ?? null,
    exitCode: execution.exitCode ?? null,
    timedOut: execution.timedOut ?? null,
    postconditionVerified: receipt?.postconditionVerified ?? null,
    reconciliationRequired: receipt?.reconciliationRequired ?? null,
    safeAutomaticReplay: receipt?.safeAutomaticReplay ?? null,
    sideEffectMayHaveCommitted: receipt?.sideEffectMayHaveCommitted ?? null,
    imageProofClaimed: proofState.claimed,
    imageProofValid: proofState.valid,
    imageProofValidationFailure: proofState.reason,
    imageProofPresent: imageProof !== null,
    imageProofCorrelation: correlation,
    imageProof: imageProof ? {
      kind: imageProof.kind,
      proofContract: imageProof.proofContract,
      receiptContract: imageProof.receiptContract,
      status: imageProof.status ?? null,
      phase: imageProof.phase ?? null,
      preset: imageProof.preset ?? null,
      technicalArtifactVerified: imageProof.technicalArtifactVerified === true,
      postconditionVerified: imageProof.postconditionVerified === true,
      terminalReceiptPersisted: imageProof.terminalReceiptPersisted === true,
      singleFilePhysicalProof: imageProof.singleFilePhysicalProof === true,
    } : null,
    failureClass: classifyReceipt(receipt, correlation, proofState),
    rawReceipt: receipt,
    credentialValuesReturned: false,
  };
}

async function readIssue(repository, issueNumber) {
  const output = await runGh([
    "issue", "view", String(issueNumber), "--repo", repository,
    "--json", "number,state,stateReason,comments",
  ]);
  const issue = JSON.parse(output);
  const comments = Array.isArray(issue.comments) ? issue.comments : [];
  let receipt = null;
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    receipt = parseJsonReceiptText(comments[index]?.body ?? "");
    if (receipt) break;
  }
  return { issue, receipt };
}

async function authorReviewedAction(action) {
  if (!ACTIONS.includes(action)) throw new Error("reviewed action is not allowlisted");
  const output = await runFile(reviewedActionAuthor(), ["plan", "--action", action], 30_000);
  const plan = parseObject(output, "reviewed action author");
  if (plan.kind !== "evavo-reviewed-workstation-action-plan-v3" || plan.action !== action) {
    throw new Error("reviewed action author identity drifted");
  }
  if (plan.fixedActionMapping !== true || plan.callerSelectedScript !== false || plan.callerSelectedArguments !== false) {
    throw new Error("reviewed action author authority contract drifted");
  }
  const issuePlan = asObject(plan.issuePlan, "reviewed action issue plan");
  const repository = String(issuePlan.repository || "").trim();
  const title = String(issuePlan.title || "");
  const body = String(issuePlan.body || "");
  if (repository !== "EVAVO-STUDIO/evavo-local-compute") throw new Error("reviewed action repository drifted");
  if (!title.startsWith("[EVAVO LOCAL EXEC] ")) throw new Error("reviewed action title namespace drifted");
  if (!body || Buffer.byteLength(body, "utf8") > MAX_ISSUE_BODY_BYTES) throw new Error("reviewed action issue body is invalid");
  const envelope = parseObject(body, "reviewed action queue envelope");
  if (envelope.kind !== "evavo-local-execution-queue-job-v1" || envelope.jobId !== plan.request?.requestId) {
    throw new Error("reviewed action queue envelope correlation drifted");
  }
  if (envelope.request?.requestId !== envelope.jobId) throw new Error("reviewed action request ID correlation drifted");
  return { plan, issuePlan, repository, title, body };
}

async function publishIssue(exactPlan) {
  const payload = JSON.stringify({ title: exactPlan.title, body: exactPlan.body });
  if (Buffer.byteLength(payload, "utf8") > MAX_ISSUE_PUBLICATION_BYTES) {
    throw new Error("reviewed action issue publication payload is too large");
  }
  const created = await runGh(
    ["api", "-X", "POST", `repos/${exactPlan.repository}/issues`, "--input", "-", "--jq", ".number"],
    30_000,
    payload,
  );
  const issueNumber = Number(created.trim());
  if (!Number.isInteger(issueNumber) || issueNumber < 1) throw new Error("reviewed action issue creation returned no issue number");
  return issueNumber;
}

async function waitForReceipt(repository, issueNumber, waitSeconds, pollSeconds) {
  const deadline = Date.now() + waitSeconds * 1000;
  while (Date.now() < deadline) {
    const { issue, receipt } = await readIssue(repository, issueNumber);
    if (receipt) return normalizeReceipt(receipt, issueNumber);
    if (issue.state === "CLOSED") {
      return {
        schemaVersion: 2,
        kind: "evavo-reviewed-workstation-session-result-v2",
        ok: false,
        issueNumber,
        terminal: true,
        failureClass: "closed-without-authoritative-receipt",
        safeAutomaticReplay: false,
        credentialValuesReturned: false,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
  }
  return {
    schemaVersion: 2,
    kind: "evavo-reviewed-workstation-session-result-v2",
    ok: false,
    issueNumber,
    terminal: false,
    failureClass: "mcp-wait-timeout",
    safeAutomaticReplay: false,
    note: "The reviewed queue job may still be executing; reconcile this issue before submitting another physical attempt.",
    credentialValuesReturned: false,
  };
}

async function submitAndWait(rawArgs) {
  const args = asObject(rawArgs, "arguments");
  const action = String(args.action || "").trim();
  if (!ACTIONS.includes(action)) throw new Error("reviewed action is not allowlisted");
  const waitSeconds = Number.isInteger(args.waitSeconds) ? args.waitSeconds : DEFAULT_WAIT_SECONDS;
  const pollSeconds = Number.isInteger(args.pollSeconds) ? args.pollSeconds : DEFAULT_POLL_SECONDS;
  if (waitSeconds < 30 || waitSeconds > MAX_WAIT_SECONDS) throw new Error("waitSeconds is outside the reviewed bound");
  if (pollSeconds < 2 || pollSeconds > 30) throw new Error("pollSeconds is outside the reviewed bound");
  const authored = await authorReviewedAction(action);
  const issueNumber = await publishIssue(authored);
  const result = await waitForReceipt(authored.repository, issueNumber, waitSeconds, pollSeconds);
  return {
    ...result,
    action,
    authoredRequestId: authored.plan.request?.requestId ?? null,
    outerQueueJobIdBoundIntoProof: authored.plan.outerQueueJobIdBoundIntoProof === true,
    authoredRequestMatchesReceiptJob: result.jobId ? result.jobId === authored.plan.request?.requestId : null,
    callerSelectedScript: false,
    callerSelectedArguments: false,
    callerSelectedManifest: false,
    callerSelectedOutputPath: false,
    publicationPerformed: true,
  };
}

async function callTool(name, raw) {
  const args = raw === undefined ? {} : asObject(raw, "arguments");
  if (name === "evavo_reviewed_workstation_actions") {
    const output = await runFile(reviewedActionAuthor(), ["catalog"], 30_000);
    const catalog = parseObject(output, "reviewed action catalog");
    return {
      ...catalog,
      transport: "github-receipt-relay",
      primaryRemoteTransportMayBeCloudflareTypedRelay: true,
      localStorage4329UsedForImageExecution: false,
      callerMaySupplyScript: false,
      callerMaySupplyArguments: false,
      credentialValuesReturned: false,
    };
  }
  if (name === "evavo_reviewed_workstation_submit_and_wait") return submitAndWait(args);
  if (name === "evavo_reviewed_workstation_job_status") {
    if (!Number.isInteger(args.issueNumber) || args.issueNumber < 1) throw new Error("issueNumber is invalid");
    const { issue, receipt } = await readIssue("EVAVO-STUDIO/evavo-local-compute", args.issueNumber);
    if (receipt) return normalizeReceipt(receipt, args.issueNumber);
    return {
      schemaVersion: 2,
      kind: "evavo-reviewed-workstation-session-result-v2",
      ok: false,
      issueNumber: args.issueNumber,
      terminal: issue.state === "CLOSED",
      issueState: issue.state,
      failureClass: issue.state === "CLOSED" ? "closed-without-authoritative-receipt" : "pending",
      safeAutomaticReplay: false,
      credentialValuesReturned: false,
    };
  }
  throw new Error(`unknown tool: ${name}`);
}

const result = (id, value) => ({ jsonrpc: "2.0", id: id ?? null, result: value });
const error = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

for await (const line of input) {
  if (!line.trim()) continue;
  let request;
  try { request = JSON.parse(line); } catch { write(error(null, -32700, "Parse error")); continue; }
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") { write(error(request.id, -32600, "Invalid request")); continue; }
  try {
    if (request.method === "notifications/initialized") continue;
    if (request.method === "ping") write(result(request.id, {}));
    else if (request.method === "initialize") write(result(request.id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "evavo-reviewed-workstation-actions-mcp", version: "1.4.0" } }));
    else if (request.method === "tools/list") write(result(request.id, { tools: TOOLS }));
    else if (request.method === "tools/call") {
      const params = asObject(request.params, "params");
      const value = await callTool(String(params.name ?? ""), params.arguments);
      write(result(request.id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError: false }));
    } else write(error(request.id, -32601, "Method not found"));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown error";
    write(result(request.id, { content: [{ type: "text", text: JSON.stringify({ ok: false, error: message, safeAutomaticReplay: false, credentialValuesReturned: false }) }], isError: true }));
  }
}
