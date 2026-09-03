from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MCP = ROOT / "mcp-server" / "zero-cost-physical-acceptance-mcp.mjs"
CONFIG = ROOT / ".mcp.json"


def test_physical_acceptance_mcp_is_single_purpose_and_argument_free() -> None:
    source = MCP.read_text(encoding="utf-8")
    for token in (
        'name:"evavo_zero_cost_physical_acceptance"',
        'inputSchema:{type:"object",additionalProperties:false,properties:{}}',
        'physical acceptance accepts no arguments',
        'Invoke-EvavoZeroCostPhysicalAcceptanceCurrent.ps1',
        'shell:false',
        'windowsHide:true',
        'receipt.kind!=="evavo-zero-cost-physical-acceptance-current-v1"',
        'convergence.kind!=="evavo-zero-cost-watchdog-physical-convergence-v1"',
        'convergence.persistentAutomationWatchdogExactPayloadRunning!==true',
        'convergence.temporaryWorkspaceCleanupVerified!==true',
    ):
        assert token in source


def test_physical_acceptance_mcp_does_not_gain_general_execution_authority() -> None:
    source = MCP.read_text(encoding="utf-8")
    for token in (
        '"io.evavo/arbitraryCommandTextAccepted":false',
        '"io.evavo/callerExecutableAccepted":false',
        '"io.evavo/callerScriptPathAccepted":false',
        '"io.evavo/callerArgvAccepted":false',
        '"io.evavo/providerMutationAuthority":false',
        '"io.evavo/businessTaskReplayAuthority":false',
        '"io.evavo/administratorElevationAllowed":false',
        '"io.evavo/githubActionsRequired":false',
        '"io.evavo/vercelRequired":false',
        '"io.evavo/paidComputeRequired":false',
        'receipt.acceptanceIsRecoveryAuthority!==false',
        'receipt.arbitraryCommandTextAccepted!==false',
        'convergence.arbitraryTaskAuthority!==false',
        'convergence.arbitraryCommandAuthority!==false',
        'convergence.effectfulBusinessTaskReplay!==false',
    ):
        assert token in source

    lowered = source.casefold()
    for forbidden in (
        "exec(",
        "eval(",
        "shell:true",
        "workflow_dispatch",
        "actions/checkout",
        "-encodedcommand",
        "cmd.exe",
    ):
        assert forbidden not in lowered


def test_physical_acceptance_mcp_is_registered_with_only_local_storage_root() -> None:
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    entry = config["mcpServers"]["evavo-zero-cost-physical-acceptance"]
    assert entry["command"] == "node"
    assert entry["args"] == ["./mcp-server/zero-cost-physical-acceptance-mcp.mjs"]
    assert entry["env"] == {"EVAVO_LOCAL_STORAGE_ROOT": r"C:\GitRepos\evavo-local-storage"}
