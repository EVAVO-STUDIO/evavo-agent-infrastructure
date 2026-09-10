import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'mcp-server', 'reviewed-workstation-actions-mcp.mjs'), 'utf8');
const localMcp = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8'));
const unified = JSON.parse(fs.readFileSync(path.join(root, 'config', 'chatgpt-unified-capability-surface.v1.json'), 'utf8'));

test('reviewed workstation MCP exposes only fixed action selection plus receipt lookup', () => {
  for (const action of [
    'resident-status',
    'comfyui-open-ui',
    'image-smoke-cel-animation',
    'image-smoke-90s-game-art',
    'image-smoke-realistic',
    'naomi-qoh-vercel-go-live',
    'vercel-control-commission',
  ]) assert.match(source, new RegExp(`"${action}"`));

  assert.match(source, /name: "evavo_reviewed_workstation_actions"/);
  assert.match(source, /name: "evavo_open_comfyui_ui"/);
  assert.match(source, /name: "evavo_reviewed_workstation_submit"/);
  assert.match(source, /name: "evavo_reviewed_workstation_submit_and_wait"/);
  assert.match(source, /name: "evavo_reviewed_workstation_job_status"/);
  assert.doesNotMatch(source, /callerScript/);
  assert.doesNotMatch(source, /manifestPath/);
  assert.doesNotMatch(source, /outputPath/);
});

test('request truth is delegated to Local Compute reviewed action author', () => {
  assert.match(source, /evavo-reviewed-workstation-actions\.exe/);
  assert.match(source, /\["plan", "--action", action\]/);
  assert.match(source, /plan\.kind !== "evavo-reviewed-workstation-action-plan-v3"/);
  assert.match(source, /plan\.fixedActionMapping !== true/);
  assert.match(source, /plan\.callerSelectedScript !== false/);
  assert.match(source, /plan\.callerSelectedArguments !== false/);
  assert.match(source, /envelope\.jobId !== plan\.request\?\.requestId/);
  assert.match(source, /envelope\.request\?\.requestId !== envelope\.jobId/);
});

test('publisher sends exact authored title/body over bounded stdin and never exposes queue body in argv', () => {
  assert.match(source, /const payload = JSON\.stringify\(\{ title: exactPlan\.title, body: exactPlan\.body \}\)/);
  assert.match(source, /MAX_ISSUE_PUBLICATION_BYTES/);
  assert.match(source, /"--input", "-", "--jq", "\.number"/);
  assert.match(source, /child\.stdin\?\.end\(String\(stdinText\), "utf8"\)/);
  assert.doesNotMatch(source, /`body=\$\{exactPlan\.body\}`/);
  assert.doesNotMatch(source, /`title=\$\{exactPlan\.title\}`/);
  assert.doesNotMatch(source, /randomUUID/);
  assert.doesNotMatch(source, /requestId = `mcp-/);
  assert.match(source, /safeAutomaticReplay: false/);
});

test('long image jobs use submit plus status instead of widening the unified child call timeout', () => {
  assert.match(source, /DEFAULT_WAIT_SECONDS = 90/);
  assert.match(source, /MAX_WAIT_SECONDS = 110/);
  assert.match(source, /kind: "evavo-reviewed-workstation-submission-v1"/);
  assert.match(source, /followUpTool: "evavo_reviewed_workstation_job_status"/);
  assert.match(source, /preferredLongRunningSequence/);
  assert.match(source, /"evavo_reviewed_workstation_submit"/);
  assert.match(source, /"evavo_reviewed_workstation_job_status"/);
  const unifiedServer = fs.readFileSync(path.join(root, 'mcp-server', 'chatgpt-unified-capability-mcp.mjs'), 'utf8');
  assert.match(unifiedServer, /return this\.request\("tools\/call", \{ name: toolName, arguments: argumentsValue \}, 120_000\)/);
});

test('generic workstation fabric execution stays tightly bounded', () => {
  const generic = fs.readFileSync(path.join(root, 'mcp-server', 'local-agent-mcp-v2.mjs'), 'utf8');
  assert.match(generic, /request\.timeoutSeconds > 900/);
  assert.match(generic, /maximum: 1200/);
});

test('reviewed workstation MCP is registered in local and unified surfaces', () => {
  const local = localMcp.mcpServers['evavo-reviewed-workstation-actions'];
  assert.ok(local);
  assert.deepEqual(local.args, ['./mcp-server/reviewed-workstation-actions-mcp.mjs']);
  assert.equal(local.env.EVAVO_REVIEWED_WORKSTATION_ACTIONS_ROLE, 'fixed-reviewed-actions-only');

  const server = unified.servers.find((item) => item.id === 'evavo-reviewed-workstation-actions');
  assert.ok(server);
  assert.equal(server.directExpose, true);
  assert.equal(server.authority, 'EVAVO-STUDIO/evavo-local-compute');
  assert.deepEqual(server.arguments, ['mcp-server/reviewed-workstation-actions-mcp.mjs']);
});

test('reviewed image route explicitly stays out of Local Storage 4329', () => {
  assert.match(source, /localStorage4329UsedForImageExecution: false/);
  assert.match(source, /callerMaySupplyScript: false/);
  assert.match(source, /callerMaySupplyArguments: false/);
});

test('nested V3 image proof is correlated to the authoritative outer queue receipt', () => {
  assert.match(source, /IMAGE_PROOF_KIND = "evavo-local-image-smoke-proof-v3"/);
  assert.match(source, /IMAGE_PROOF_CONTRACT = "evavo-single-file-image-smoke-proof-v3"/);
  assert.match(source, /IMAGE_CHILD_RECEIPT_CONTRACT = "evavo-sha-bound-child-receipt-v1"/);
  assert.match(source, /function imageProofState\(output\)/);
  assert.match(source, /value\.proofContract !== IMAGE_PROOF_CONTRACT/);
  assert.match(source, /value\.receiptContract !== IMAGE_CHILD_RECEIPT_CONTRACT/);
  assert.match(source, /function imageProofCorrelation\(receipt, proof\)/);
  assert.match(source, /proof\.outerQueueJobId === outerJobId/);
  assert.match(source, /producerScriptSha256 === outerScriptSha256/);
  assert.match(source, /proof\.technicalArtifactVerified === true && proof\.postconditionVerified === true/);
  assert.match(source, /proof\.singleFilePhysicalProof === true/);
  assert.match(source, /proof\.dynamicChildScriptLoaded === false/);
  assert.match(source, /proof\.gitSha1ChildDependency === false/);
});

test('reviewed image jobs require proof even when worker output is missing entirely', () => {
  assert.match(source, /REVIEWED_IMAGE_JOB_ID/);
  assert.match(source, /function imageProofRequiredForReceipt\(receipt\)/);
  assert.match(source, /const proofRequiredByJob = imageProofRequiredForReceipt\(receipt\)/);
  assert.match(source, /const imageProofRequired = proofRequiredByJob \|\| proofState\.claimed === true/);
  assert.match(source, /proofRequiredByJob && proofState\?\.claimed !== true/);
  assert.match(source, /"image-proof-missing"/);
  assert.match(source, /imageProofRequiredByJob: proofRequiredByJob/);
});

test('normalized image proof keeps proof and child receipt identities separate', () => {
  assert.match(source, /proofContract: imageProof\.proofContract/);
  assert.match(source, /receiptContract: imageProof\.receiptContract/);
  assert.doesNotMatch(source, /value\.receiptContract !== IMAGE_PROOF_CONTRACT/);
});

test('claimed malformed or identity-drifted image proof fails closed', () => {
  assert.match(source, /const markerClaimed = raw\.includes\(IMAGE_PROOF_KIND\)/);
  assert.match(source, /"image-proof-json-invalid"/);
  assert.match(source, /"image-proof-contract-invalid"/);
  assert.match(source, /"image-proof-child-receipt-contract-invalid"/);
  assert.match(source, /proofState\?\.claimed === true && proofState\.valid !== true/);
  assert.match(source, /proofState\.valid === true && correlation\?\.correlated === true/);
  assert.match(source, /imageProofClaimed: proofState\.claimed/);
  assert.match(source, /imageProofValid: proofState\.valid/);
});

test('correlation requires the complete hash chain and fails closed on mismatch', () => {
  for (const field of [
    'manifestSha256',
    'requestSha256',
    'innerReceiptSha256',
    'batchReceiptSha256',
    'terminalReceiptSha256',
    'receiptDigestSha256',
  ]) assert.match(source, new RegExp(`proof\\.${field}`));
  assert.match(source, /return "image-proof-correlation-failed"/);
  assert.match(source, /ok: outerOk && imageProofOk/);
  assert.match(source, /authoredRequestMatchesReceiptJob/);
});

test('correlated proof cannot silently grant approval, publication, mutation or replay', () => {
  assert.match(source, /proof\.safeAutomaticReplay === false/);
  assert.match(source, /proof\.creativeApprovalGranted === false/);
  assert.match(source, /proof\.modelPromotionGranted === false/);
  assert.match(source, /proof\.publicationGranted === false/);
  assert.match(source, /proof\.repositoryMutationGranted === false/);
});


test("ComfyUI chat shortcut is fixed, effectful and receipt-verified", () => {
  assert.match(source, /REVIEWED_COMFYUI_JOB_ID/);
  assert.match(source, /COMFYUI_PROOF_KIND = "evavo-comfyui-chat-open-receipt-v1"/);
  assert.match(source, /name: "evavo_open_comfyui_ui"/);
  assert.match(source, /additionalProperties: false, properties: \{\}/);
  assert.match(source, /submitReviewed\(\{ action: "comfyui-open-ui" \}\)/);
  assert.match(source, /function comfyUiProofState\(output\)/);
  assert.match(source, /nativeBackendReady: true/);
  assert.match(source, /browserLaunchDispatched: true/);
  assert.match(source, /computerAgentRevision: COMFYUI_COMPUTER_AGENT_REVISION/);
  assert.match(source, /ok: outerOk && imageProofOk && comfyUiProofOk/);
  assert.match(source, /comfyUiProofValidationFailure/);
  assert.doesNotMatch(source, /evavo_open_comfyui_ui.*callerUrl/s);
});

test("ComfyUI chat shortcut prefers the typed relay and falls back only before dispatch", () => {
  assert.match(source, /EVAVO_REMOTE_MCP_RELAY_BASE_URL/);
  assert.match(source, /EVAVO_REMOTE_MCP_RELAY_DISPATCH_TOKEN/);
  assert.match(source, /action: COMFYUI_RELAY_ACTION, arguments: \{\}, wait: false, timeoutMs: 600_000/);
  assert.match(source, /status\.body\?\.online !== true/);
  assert.match(source, /status\.body\?\.journalReady !== true/);
  assert.match(source, /outcome is uncertain; reconcile before retrying/);
  assert.match(source, /automatic fallback is disabled after submission/);
  assert.match(source, /transport: "github-receipt-relay"/);
  assert.doesNotMatch(source, /callerSelectedUrl:\s*true|arbitraryCommandAccepted:\s*true/);
});
