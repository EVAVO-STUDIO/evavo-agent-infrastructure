[CmdletBinding()]
param(
    [string]$LocalStorageRepo = 'C:\GitRepos\evavo-local-storage',
    [switch]$IncludeOperatorExecution,
    [switch]$IncludeWorkstationAcceptance,
    [switch]$NoRepair,
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'EVAVO Chat Local Agent readiness targets Windows only.' }
# Older EVAVO child PowerShell entrypoints still use the conventional OS environment
# marker. Queue-launched PowerShell can omit it even on Windows, so normalize it for
# this verified Windows process and the child processes spawned below.
$env:OS = 'Windows_NT'

$AgentInfraRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$AcceptanceScript = Join-Path $PSScriptRoot 'Test-EvavoLocalAgentMcp043.ps1'
$LocalStorageRoot = [IO.Path]::GetFullPath($LocalStorageRepo).TrimEnd('\')
$NodeManager = Join-Path $LocalStorageRoot 'scripts\manage-autonomous-node.ps1'

if (-not (Test-Path -LiteralPath $AcceptanceScript -PathType Leaf)) {
    throw 'Canonical Local Agent MCP acceptance script is missing.'
}
if (-not (Test-Path -LiteralPath $NodeManager -PathType Leaf)) {
    throw "EVAVO Local Storage node manager was not found at $NodeManager"
}

function Invoke-Acceptance {
    $args = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$AcceptanceScript)
    if ($IncludeOperatorExecution) { $args += '-IncludeOperatorExecution' }
    if ($IncludeWorkstationAcceptance) { $args += '-IncludeWorkstationAcceptance' }
    $stdout = & powershell.exe @args 2>&1
    $exitCode = $LASTEXITCODE
    [pscustomobject]@{
        ok = ($exitCode -eq 0)
        exitCode = $exitCode
        output = @($stdout | ForEach-Object { [string]$_ })
    }
}

function Invoke-NodeManager([ValidateSet('status','diagnose','restart','repair')][string]$Action) {
    $stdout = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $NodeManager -Action $Action 2>&1
    $exitCode = $LASTEXITCODE
    [pscustomobject]@{
        action = $Action
        ok = ($exitCode -eq 0)
        exitCode = $exitCode
        output = @($stdout | ForEach-Object { [string]$_ })
    }
}

$StartedAt = [DateTimeOffset]::UtcNow
$Initial = Invoke-Acceptance
$Steps = [System.Collections.Generic.List[object]]::new()
$Steps.Add([pscustomobject]@{ step='acceptance-initial'; ok=$Initial.ok; exitCode=$Initial.exitCode })
$Repaired = $false

if (-not $Initial.ok -and -not $NoRepair) {
    $Diagnosis = Invoke-NodeManager -Action diagnose
    $Steps.Add([pscustomobject]@{ step='diagnose'; ok=$Diagnosis.ok; exitCode=$Diagnosis.exitCode })

    $Repair = Invoke-NodeManager -Action repair
    $Steps.Add([pscustomobject]@{ step='repair'; ok=$Repair.ok; exitCode=$Repair.exitCode })
    if (-not $Repair.ok) {
        $Receipt = [ordered]@{
            schemaVersion = 1
            kind = 'evavo-chat-local-agent-readiness-v1'
            ok = $false
            repaired = $false
            reason = 'repair-failed'
            startedAt = $StartedAt.ToString('O')
            completedAt = [DateTimeOffset]::UtcNow.ToString('O')
            agentInfrastructureRoot = $AgentInfraRoot
            localStorageRoot = $LocalStorageRoot
            steps = @($Steps)
            initialAcceptanceOutput = $Initial.output
            diagnosisOutput = $Diagnosis.output
            repairOutput = $Repair.output
            permanentDeleteAuthorityAdded = $false
            operatorExecutionRequested = [bool]$IncludeOperatorExecution
        }
        if ($Json) { $Receipt | ConvertTo-Json -Depth 10 } else { $Receipt }
        exit 1
    }

    $Restart = Invoke-NodeManager -Action restart
    $Steps.Add([pscustomobject]@{ step='restart'; ok=$Restart.ok; exitCode=$Restart.exitCode })
    if (-not $Restart.ok) {
        throw 'Local Storage repair completed but autonomous-node restart failed.'
    }

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(45)
    do {
        Start-Sleep -Milliseconds 750
        $socketReady = $false
        try {
            $client = [Net.Sockets.TcpClient]::new()
            try {
                $task = $client.ConnectAsync('127.0.0.1',4329)
                if ($task.Wait(800) -and $client.Connected) { $socketReady = $true }
            } finally { $client.Dispose() }
        } catch { $socketReady = $false }
        if ($socketReady) { break }
    } while ([DateTimeOffset]::UtcNow -lt $deadline)

    $Final = Invoke-Acceptance
    $Steps.Add([pscustomobject]@{ step='acceptance-after-repair'; ok=$Final.ok; exitCode=$Final.exitCode })
    $Repaired = $Final.ok
} else {
    $Final = $Initial
}

$Status = Invoke-NodeManager -Action status
$Steps.Add([pscustomobject]@{ step='node-status'; ok=$Status.ok; exitCode=$Status.exitCode })

$Receipt = [ordered]@{
    schemaVersion = 1
    kind = 'evavo-chat-local-agent-readiness-v1'
    ok = [bool]($Final.ok -and $Status.ok)
    repaired = [bool]$Repaired
    repairAttempted = [bool](-not $Initial.ok -and -not $NoRepair)
    noRepairRequested = [bool]$NoRepair
    operatorExecutionRequested = [bool]$IncludeOperatorExecution
    workstationAcceptanceRequested = [bool]$IncludeWorkstationAcceptance
    loopbackRest = 'http://127.0.0.1:4329'
    canonicalMcp = 'mcp-server/local-agent-mcp.mjs'
    localStorageNodeManager = 'scripts/manage-autonomous-node.ps1'
    startedAt = $StartedAt.ToString('O')
    completedAt = [DateTimeOffset]::UtcNow.ToString('O')
    steps = @($Steps)
    acceptanceOutput = $Final.output
    nodeStatusOutput = $Status.output
    automaticRetryCount = $(if ($Initial.ok) { 0 } else { 1 })
    permanentDeleteAuthorityAdded = $false
}

if ($Json) { $Receipt | ConvertTo-Json -Depth 10 } else { $Receipt }
if (-not $Receipt.ok) { exit 1 }
