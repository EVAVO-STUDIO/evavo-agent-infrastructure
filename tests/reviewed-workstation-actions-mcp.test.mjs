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
    'image-smoke-cel-animation',
    'image-smoke-90s-game-art',
    'image-smoke-realistic',
  ]) assert.match(source, new RegExp(`"${action}"`));

  assert.match(source, /name: "evavo_reviewed_workstation_actions"/);
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

test('heavy image jobs have a dedicated wait bound without widening generic fabric execution', () => {
  assert.match(source, /MAX_WAIT_SECONDS = 3900/);
  assert.match(source, /DEFAULT_WAIT_SECONDS = 3600/);
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
  assert.match(source, /const imageProofRequired = proofState\.claimed === true/);
  assert.match(source, /proofState\.valid === true && correlation\?\.correlated === true/);
  assert.match(source, /imageProofClaimed: proofState\.claimed/);
  assert.match(source, /imageProofValid: proofState\.valid/);
  assert.match(source, /imageProofValidationFailure: proofState\.reason/);
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
