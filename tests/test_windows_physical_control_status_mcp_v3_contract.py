from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MCP = ROOT / "mcp-server" / "windows-physical-control-status-mcp.mjs"


def test_mcp_consumes_only_canonical_v3_physical_status_projection() -> None:
    source = MCP.read_text(encoding="utf-8")
    for token in (
        'const SERVER_VERSION = "1.5.0"',
        'Get-EvavoWindowsPhysicalControlStatusCurrentV3.ps1',
        'receipt.kind !== "evavo-windows-physical-control-status-current-v3"',
        'receipt.canonicalQueueAuthority !== "hkcu_run_python"',
        'receipt.legacyScheduledQueueConsumersAuthoritative !== false',
        'receipt.singleNormalQueueConsumerRequired !== true',
        'receipt.watchdogConsumesQueue !== false',
        'resident.authority !== "canonical-normal-queue-consumer"',
        'watchdog.authority !== "non-consuming-liveness-guard"',
        'admission.observationOnly !== true',
        'admission.grantsExecutionAuthority !== false',
    ):
        assert token in source


def test_mcp_exposes_zero_cost_automation_status_v4_as_second_read_only_tool() -> None:
    source = MCP.read_text(encoding="utf-8")
    for token in (
        'const LOCAL_STORAGE_ROOT = process.env.EVAVO_LOCAL_STORAGE_ROOT',
        'Get-EvavoZeroCostWorkerAutomationStatusV4.ps1',
        'name: "evavo_zero_cost_automation_status"',
        'recoveryReceiptFreshSeconds',
        'updaterFallbackFreshSeconds',
        'automationWatchdogFreshSeconds',
        '"-AutomationWatchdogFreshSeconds"',
        'receipt.kind !== "evavo-zero-cost-worker-automation-status-v4"',
        'typeof receipt.persistentAutomationWatchdogHealthy !== "boolean"',
        'receipt.persistentAutomationWatchdogConsumesQueue !== false',
        'receipt.persistentAutomationWatchdogFixedGuardianRepairOnly !== true',
        'receipt.persistentAutomationWatchdogPresenceAloneIsNotLivenessProof !== true',
        'receipt.taskPresenceIsNotLivenessProof !== true',
        'receipt.staleRecoveryReceiptCannotProveLiveness !== true',
        'receipt.staleUpdaterReceiptCannotProveLiveness !== true',
        'receipt.freshPhysicalStatusPreferred !== true',
        'fresh-persisted-canonical-recovery-receipt',
        'fresh-updater-canonical-queue-preflight',
        'receipt.persistentAutomationWatchdogProcessAlive !== true',
        'receipt.persistentAutomationWatchdogExactPayloadRunning !== true',
        'receipt.baseAutomationHealthy === true && receipt.canonicalQueueHealthy === true && receipt.persistentAutomationWatchdogHealthy === true',
        'tools: [PHYSICAL_TOOL, AUTOMATION_TOOL]',
    ):
        assert token in source


def test_mcp_does_not_turn_unhealthy_automation_state_into_transport_error() -> None:
    source = MCP.read_text(encoding="utf-8")
    assert 'typeof receipt.ok !== "boolean"' in source
    assert 'typeof receipt.canonicalQueueHealthy !== "boolean"' in source
    assert 'typeof receipt.persistentAutomationWatchdogHealthy !== "boolean"' in source
    assert 'if (receipt.canonicalQueueHealthy === true)' in source
    assert 'if (receipt.persistentAutomationWatchdogHealthy === true)' in source
    assert 'source === "unavailable"' in source
    assert 'return { ...receipt, invokedThrough: SERVER_NAME, arbitraryCommandTextAccepted: false };' in source


def test_mcp_is_read_only_zero_cost_and_rejects_arbitrary_execution() -> None:
    source = MCP.read_text(encoding="utf-8")
    for token in (
        'readOnlyHint: true',
        'destructiveHint: false',
        '"io.evavo/effects": ["read"]',
        '"io.evavo/arbitraryCommandTextAccepted": false',
        '"io.evavo/inlineCodeAccepted": false',
        '"io.evavo/persistentAutomationWatchdogConsumesQueue": false',
        '"io.evavo/githubActionsRequired": false',
        '"io.evavo/vercelRequired": false',
        '"io.evavo/paidComputeRequired": false',
        'receipt.mutationPerformed !== false',
        'receipt.providerMutationPerformed !== false',
        'receipt.taskMutationPerformed !== false',
        'receipt.processExecutionPerformed !== false',
        'receipt.githubActionsRequired !== false',
        'receipt.selfHostedActionsRunnerRequired !== false',
        'receipt.vercelRequired !== false',
        'receipt.paidComputeRequired !== false',
        'shell: false',
    ):
        assert token in source

    lowered = source.casefold()
    for forbidden in (
        "exec(",
        "eval(",
        "shell: true",
        "workflow_dispatch",
        "actions/checkout",
    ):
        assert forbidden not in lowered
