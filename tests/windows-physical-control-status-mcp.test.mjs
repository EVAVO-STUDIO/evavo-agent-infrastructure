import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'mcp-server', 'windows-physical-control-status-mcp.mjs'), 'utf8');

test('physical-control MCP exposes one read-only status tool', () => {
  assert.match(source, /evavo_windows_physical_control_status/);
  assert.match(source, /Get-EvavoWindowsPhysicalControlStatusCurrent\.ps1/);
  assert.match(source, /readOnlyHint: true/);
  assert.match(source, /destructiveHint: false/);
  assert.match(source, /taskPresenceIsNotLivenessProof/);
  assert.match(source, /scheduledTaskStartIsNotOutcomeProof/);
  assert.match(source, /routeHealthIsObservationNotExecutionAuthority/);
  assert.match(source, /terminalReceiptDigestValidationRequired/);
  assert.match(source, /mutationPerformed !== false/);
  assert.match(source, /providerMutationPerformed !== false/);
  assert.match(source, /taskMutationPerformed !== false/);
  assert.match(source, /processExecutionPerformed !== false/);
  assert.match(source, /networkPerformed !== false/);
  assert.match(source, /githubActionsRequired !== false/);
  assert.match(source, /selfHostedActionsRunnerRequired !== false/);
  assert.match(source, /vercelRequired !== false/);
  assert.match(source, /paidComputeRequired !== false/);
});

test('status MCP admits only v2 route and outcome separated receipts', () => {
  assert.match(source, /SERVER_VERSION = "1\.2\.0"/);
  assert.match(source, /Number\(receipt\.schemaVersion\) !== 2/);
  assert.match(source, /receipt\.kind !== "evavo-windows-physical-control-status-current-v2"/);
  assert.match(source, /receipt\.routeLivenessSeparatedFromJobOutcome !== true/);
  assert.match(source, /receipt\.terminalJobReceiptRequiredForOutcomeClaim !== true/);
  assert.match(source, /receipt\.terminalReceiptDigestValidationRequired !== true/);
  assert.match(source, /receipt\.processSuccessIsNotPhysicalPostconditionProof !== true/);
  assert.match(source, /receipt\.verificationHelperReadOnly !== true/);
  assert.match(source, /receipt\.processExecutionFieldRepresentsEffectfulWork !== true/);
});

test('latest terminal job requires digest-validated conservative physical truth', () => {
  assert.match(source, /latest\?\.present === true/);
  assert.match(source, /latest\.structurallyAccepted !== true/);
  assert.match(source, /latest\.outcomeClaimAdmissible !== true/);
  assert.match(source, /latest\.receiptDigestValid !== true/);
  assert.match(source, /validated-by-canonical-python-verifier/);
  assert.match(source, /latest\.physicalTruthFieldsPresent !== true/);
  assert.match(source, /Number\(latest\.receiptSemanticsVersion\) < 2/);
  assert.match(source, /latest\.automaticRetryAllowed !== false/);
  assert.match(source, /latest\.safeAutomaticReplay !== false/);
  assert.match(source, /typeof latest\.sideEffectMayHaveCommitted !== "boolean"/);
  assert.match(source, /typeof latest\.postconditionVerified !== "boolean"/);
  assert.match(source, /typeof latest\.reconciliationRequired !== "boolean"/);
  assert.match(source, /typeof latest\.physicalEffectState !== "string"/);
});

test('missing terminal receipt cannot coexist with admissible terminal outcome claim', () => {
  assert.match(source, /receipt\.latestTerminalOutcomeAdmissible !== false/);
  assert.match(source, /status claimed an admissible terminal outcome without a terminal receipt/);
});

test('status MCP never exposes arbitrary command or caller path execution', () => {
  assert.match(source, /arbitraryCommandTextAccepted": false/);
  assert.match(source, /inlineCodeAccepted": false/);
  assert.doesNotMatch(source, /child_process.*exec\(/);
  assert.doesNotMatch(source, /shell:\s*true/);
  assert.doesNotMatch(source, /Start-ScheduledTask/);
  assert.doesNotMatch(source, /Register-ScheduledTask/);
});
