[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Runtime = Join-Path $Root 'mcp-server\windows-chat-execution-mcp.mjs'
if (-not (Test-Path -LiteralPath $Runtime -PathType Leaf)) { throw 'Missing windows-chat-execution-mcp.mjs.' }
$Source = Get-Content -LiteralPath $Runtime -Raw -Encoding UTF8

$Required = @(
    'evavo-windows-chat-execution-mcp',
    'SERVER_VERSION = "2.1.0"',
    'evavo_windows_execution_doctor',
    'evavo_windows_execution_route',
    'legacyRawShellExecutionRemoved: true',
    'rawShellExecutionRemoved: true',
    'arbitraryCommandTextAccepted: false',
    'inlineCodeAccepted: false',
    'currentWindowsUserRawShellAuthorityExposed: false',
    'workstationBridge: "evavo-windows-workstation-bridge"',
    'sameMachineExecutionEngine: "evavo-local-execution"',
    'effectfulCloudFallback: "github-local-execution-issue-queue"',
    'executionPerformed: false',
    'blindRetryAfterUnknownPhysicalEffectAllowed: false'
)
foreach ($Token in $Required) {
    if (-not $Source.Contains($Token)) { throw "Windows chat execution compatibility MCP is missing token: $Token" }
}

$Forbidden = @(
    'arbitraryCommandTextAccepted: true',
    'inlineCodeAccepted: true',
    'currentWindowsUserRawShellAuthorityExposed: true',
    'shell: true',
    '0.0.0.0:5000',
    'automaticApproval: true'
)
foreach ($Token in $Forbidden) {
    if ($Source.Contains($Token)) { throw "Windows chat execution compatibility MCP contains forbidden token: $Token" }
}

[ordered]@{
    schemaVersion = 2
    kind = 'evavo-windows-chat-execution-mcp-static-contract-v2'
    ok = $true
    runtime = 'mcp-server/windows-chat-execution-mcp.mjs'
    serverVersion = '2.1.0'
    chatFacing = $true
    compatibilityShim = $true
    rawShellExecutionRemoved = $true
    arbitraryCommandTextAccepted = $false
    inlineCodeAccepted = $false
    currentWindowsUserRawShellAuthorityExposed = $false
    canonicalStructuredExecutor = 'evavo-local-compute'
    canonicalWorkstationBridge = 'evavo-windows-workstation-bridge'
    effectfulCloudFallback = 'github-local-execution-issue-queue'
    workstationContacted = $false
    commandExecuted = $false
} | ConvertTo-Json -Depth 8
