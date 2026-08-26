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
    'version: SERVER_VERSION',
    'evavo_windows_execution_doctor',
    'evavo_windows_execute',
    'evavo_windows_execute_batch',
    'EVAVO_WINDOWS_CHAT_EXECUTION_ENABLED',
    'EVAVO_WINDOWS_CHAT_EXECUTION_AUTO_RECOVER',
    'Test-EvavoAcceptedRestExecutorSource.ps1',
    'Install-RestExecutorV5Task.ps1',
    'http://127.0.0.1:5000',
    'powershell',
    'cmd',
    'bash',
    'python',
    'maximumInteractiveSeconds: 300',
    'arbitraryCommandTextAccepted: true',
    'inlineCodeAccepted: true',
    'currentWindowsUserAuthority: true',
    'acceptedSourceAttested: true',
    'loopbackOnly: true',
    'commandTextReturned: false',
    'longJobsUseReviewedLocalExecution: true'
)
foreach ($Token in $Required) {
    if (-not $Source.Contains($Token)) { throw "Windows chat execution MCP is missing token: $Token" }
}

$Forbidden = @(
    'shell: true',
    '0.0.0.0:5000',
    'automaticApproval: true',
    'currentWindowsUserAuthority: false',
    'arbitraryCommandTextAccepted: false,\n      "io.evavo/inlineCodeAccepted": true'
)
foreach ($Token in $Forbidden) {
    if ($Source.Contains($Token)) { throw "Windows chat execution MCP contains forbidden token: $Token" }
}

[ordered]@{
    schemaVersion = 1
    kind = 'evavo-windows-chat-execution-mcp-static-contract-v1'
    ok = $true
    runtime = 'mcp-server/windows-chat-execution-mcp.mjs'
    serverVersion = '1.0.0'
    chatFacing = $true
    arbitraryCommandTextAccepted = $true
    inlineCodeAccepted = $true
    currentWindowsUserAuthority = $true
    shells = @('powershell','cmd','bash','python')
    interactiveTimeoutMaximumSeconds = 300
    acceptedSourceAttestationRequired = $true
    loopbackHealthRequired = $true
    automaticRuntimeRecovery = $true
    durableLongJobsRemainReviewed = $true
    workstationContacted = $false
    commandExecuted = $false
} | ConvertTo-Json -Depth 8
