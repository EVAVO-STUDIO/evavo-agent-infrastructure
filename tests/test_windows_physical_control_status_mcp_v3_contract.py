from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MCP = ROOT / "mcp-server" / "windows-physical-control-status-mcp.mjs"


def test_mcp_consumes_only_canonical_v3_status_projection() -> None:
    source = MCP.read_text(encoding="utf-8")
    for token in (
        'const SERVER_VERSION = "1.3.0"',
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


def test_mcp_is_read_only_zero_cost_and_rejects_arbitrary_execution() -> None:
    source = MCP.read_text(encoding="utf-8")
    for token in (
        'readOnlyHint: true',
        'destructiveHint: false',
        '"io.evavo/effects": ["read"]',
        '"io.evavo/arbitraryCommandTextAccepted": false',
        '"io.evavo/inlineCodeAccepted": false',
        '"io.evavo/githubActionsRequired": false',
        '"io.evavo/vercelRequired": false',
        '"io.evavo/paidComputeRequired": false',
        'receipt.mutationPerformed !== false',
        'receipt.providerMutationPerformed !== false',
        'receipt.taskMutationPerformed !== false',
        'receipt.processExecutionPerformed !== false',
        'receipt.networkPerformed !== false',
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
