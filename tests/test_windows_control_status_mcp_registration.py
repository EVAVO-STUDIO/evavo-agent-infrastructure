from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MCP_CONFIG = ROOT / ".mcp.json"
SERVER = ROOT / "mcp-server" / "windows-physical-control-status-mcp.mjs"


def test_registered_status_server_exposes_both_canonical_roots() -> None:
    config = json.loads(MCP_CONFIG.read_text(encoding="utf-8"))
    entry = config["mcpServers"]["evavo-windows-physical-control-status"]
    assert entry["command"] == "node"
    assert entry["args"] == ["./mcp-server/windows-physical-control-status-mcp.mjs"]
    assert entry["env"]["EVAVO_LOCAL_COMPUTE_ROOT"] == r"C:\GitRepos\evavo-local-compute"
    assert entry["env"]["EVAVO_LOCAL_STORAGE_ROOT"] == r"C:\GitRepos\evavo-local-storage"


def test_registered_server_lists_physical_and_zero_cost_status_tools() -> None:
    source = SERVER.read_text(encoding="utf-8")
    assert 'name: "evavo_windows_physical_control_status"' in source
    assert 'name: "evavo_zero_cost_automation_status"' in source
    assert "tools: [PHYSICAL_TOOL, AUTOMATION_TOOL]" in source
    assert 'const SERVER_VERSION = "1.5.0"' in source
    assert 'automationWatchdogFreshSeconds' in source
    assert 'persistentAutomationWatchdogHealthy' in source


def test_registration_does_not_add_an_effectful_or_hosted_status_plane() -> None:
    source = MCP_CONFIG.read_text(encoding="utf-8").casefold()
    server = SERVER.read_text(encoding="utf-8").casefold()
    assert "workflow_dispatch" not in server
    assert "shell: true" not in server
    assert '"io.evavo/effects": ["read"]' in server
    assert '"io.evavo/persistentautomationwatchdogconsumesqueue": false' in server
    assert '"io.evavo/githubactionsrequired": false' in server
    assert '"io.evavo/vercelrequired": false' in server
    assert '"io.evavo/paidcomputerequired": false' in server
    assert "windows-physical-control-status-mcp.mjs" in source
