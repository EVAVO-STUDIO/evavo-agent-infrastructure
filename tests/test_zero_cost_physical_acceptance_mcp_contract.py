from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MCP = ROOT / "mcp-server" / "zero-cost-physical-acceptance-mcp.mjs"
CONFIG = ROOT / ".mcp.json"


def test_physical_acceptance_mcp_is_single_purpose_argument_free_and_repository_independent() -> None:
    source = MCP.read_text(encoding="utf-8")
    for token in (
        'const SERVER_VERSION = "1.1.0"',
        'name:"evavo_zero_cost_physical_acceptance"',
        'inputSchema:{type:"object",additionalProperties:false,properties:{}}',
        'physical acceptance accepts no arguments',
        '"io.evavo/repositoryIndependentManagedClone":true',
        '"io.evavo/developerCheckoutMutationAllowed":false',
        'ZeroCostPhysicalAcceptanceMcp',
        'gh.exe',[
        ][0] if False else '"repo","clone",REPOSITORY,workspace',
        '"--filter=blob:none","--no-tags","--single-branch","--branch","main"',
        'temporary Local Storage checkout is not exact clean current main',
        'Invoke-EvavoZeroCostPhysicalAcceptanceCurrent.ps1',
        'shell:false',
        'windowsHide:true',
        'receipt.kind!=="evavo-zero-cost-physical-acceptance-current-v1"',
        'receipt.revision!==onlineMain',
        'convergence.kind!=="evavo-zero-cost-watchdog-physical-convergence-v1"',
        'convergence.persistentAutomationWatchdogExactPayloadRunning!==true',
        'convergence.temporaryWorkspaceCleanupVerified!==true',
        'rmSync(workspace,{recursive:true,force:true})',
        'temporary physical acceptance checkout cleanup was not verified',
        'repositoryIndependentManagedClone:true',
        'developerCheckoutMutationAllowed:false',
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


def test_physical_acceptance_mcp_registration_does_not_grant_additional_authority() -> None:
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    entry = config["mcpServers"]["evavo-zero-cost-physical-acceptance"]
    assert entry["command"] == "node"
    assert entry["args"] == ["./mcp-server/zero-cost-physical-acceptance-mcp.mjs"]
    assert entry["env"] == {"EVAVO_LOCAL_STORAGE_ROOT": r"C:\GitRepos\evavo-local-storage"}
