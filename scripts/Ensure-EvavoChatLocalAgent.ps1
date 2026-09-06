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
$env:OS = 'Windows_NT'

$AgentInfraRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$AcceptanceScript = Join-Path $PSScriptRoot 'Test-EvavoLocalAgentMcp043.ps1'
$LocalStorageRoot = [IO.Path]::GetFullPath($LocalStorageRepo).TrimEnd('\')
$RestDiagnosis = Join-Path $LocalStorageRoot 'scripts\Get-EvavoLocalAgentRestStartupDiagnosis043.ps1'
$RestRepair = Join-Path $LocalStorageRoot 'REPAIR-EVAVO-LOCAL-AGENT-REST-043.ps1'
$McpEstablishment = Join-Path $LocalStorageRoot 'START-EVAVO-LOCAL-AGENT-MCP-043.ps1'
$NodeManager = Join-Path $LocalStorageRoot 'scripts\manage-autonomous-node.ps1'

foreach ($Path in @($AcceptanceScript,$RestDiagnosis,$RestRepair,$McpEstablishment,$NodeManager)) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required Chat Local Agent recovery component was not found: $Path" }
    $Item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($Item.PSIsContainer -or ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Chat Local Agent recovery component is unsafe: $Path" }
}

function Invoke-CapturedPowerShell {
    param([Parameter(Mandatory=$true)][string[]]$Arguments)
    $PreviousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $BaseArguments = @('-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass')
        $Captured = & powershell.exe @BaseArguments @Arguments 2>&1
        $ExitCode = [int]$LASTEXITCODE
    }
    finally { $ErrorActionPreference = $PreviousPreference }
    [pscustomobject]@{ ok=($ExitCode -eq 0); exitCode=$ExitCode; output=@($Captured | ForEach-Object { [string]$_ }) }
}

function Invoke-Acceptance {
    $Arguments = @('-File',$AcceptanceScript)
    if ($IncludeOperatorExecution) { $Arguments += '-IncludeOperatorExecution' }
    if ($IncludeWorkstationAcceptance) { $Arguments += '-IncludeWorkstationAcceptance' }
    Invoke-CapturedPowerShell -Arguments $Arguments
}

function Invoke-NodeManager([ValidateSet('status','diagnose','restart','repair')][string]$Action) {
    $Result = Invoke-CapturedPowerShell -Arguments @('-File',$NodeManager,'-Action',$Action)
    [pscustomobject]@{ action=$Action; ok=$Result.ok; exitCode=$Result.exitCode; output=$Result.output }
}

function Invoke-RestDiagnosis {
    Invoke-CapturedPowerShell -Arguments @('-File',$RestDiagnosis,'-Port','4329')
}

function Invoke-RestRepair {
    Invoke-CapturedPowerShell -Arguments @('-File',$RestRepair,'-Port','4329')
}

function Invoke-McpEstablishment {
    $Arguments = @('-File',$McpEstablishment)
    if ($IncludeOperatorExecution) { $Arguments += '-EnableOperatorExecution' }
    if ($IncludeWorkstationAcceptance) { $Arguments += '-IncludeWorkstationAcceptance' }
    Invoke-CapturedPowerShell -Arguments $Arguments
}

function Wait-LoopbackRest {
    $Deadline = [DateTimeOffset]::UtcNow.AddSeconds(45)
    do {
        Start-Sleep -Milliseconds 500
        try {
            $Client=[Net.Sockets.TcpClient]::new()
            try {
                $Task=$Client.ConnectAsync('127.0.0.1',4329)
                if($Task.Wait(800)-and$Client.Connected){ return $true }
            }
            finally { $Client.Dispose() }
        } catch { }
    } while ([DateTimeOffset]::UtcNow -lt $Deadline)
    return $false
}

$StartedAt = [DateTimeOffset]::UtcNow
$Initial = Invoke-Acceptance
$Steps = [System.Collections.Generic.List[object]]::new()
$Steps.Add([pscustomobject]@{ step='acceptance-initial'; ok=$Initial.ok; exitCode=$Initial.exitCode; authority='agent-infrastructure-acceptance' })
$Repaired = $false
$CanonicalLocalRepairAttempted = $false
$WorkerFallbackAttempted = $false
$RestReadyAfterRepair = $false
$Final = $Initial

if (-not $Initial.ok -and -not $NoRepair) {
    $CanonicalLocalRepairAttempted = $true

    $Diagnosis = Invoke-RestDiagnosis
    $Steps.Add([pscustomobject]@{ step='rest-diagnosis'; ok=$Diagnosis.ok; exitCode=$Diagnosis.exitCode; authority='local-storage-local-agent-rest' })

    $Rest = Invoke-RestRepair
    $Steps.Add([pscustomobject]@{ step='rest-repair'; ok=$Rest.ok; exitCode=$Rest.exitCode; authority='local-storage-local-agent-rest' })
    if ($Rest.ok) { $RestReadyAfterRepair = Wait-LoopbackRest }
    $Steps.Add([pscustomobject]@{ step='rest-loopback-wait'; ok=$RestReadyAfterRepair; exitCode=$(if($RestReadyAfterRepair){0}else{1}); authority='local-storage-local-agent-rest' })

    $McpRepair = Invoke-McpEstablishment
    $Steps.Add([pscustomobject]@{ step='mcp-establishment'; ok=$McpRepair.ok; exitCode=$McpRepair.exitCode; authority='local-storage-local-agent-mcp' })

    $Final = Invoke-Acceptance
    $Steps.Add([pscustomobject]@{ step='acceptance-after-canonical-local-repair'; ok=$Final.ok; exitCode=$Final.exitCode; authority='agent-infrastructure-acceptance' })

    if (-not $Final.ok) {
        # Broader worker/queue recovery is a secondary dependency repair only. It is
        # not the owner of the 4329 REST service and must never be treated as proof
        # that Local Agent readiness was restored.
        $WorkerFallbackAttempted = $true
        $WorkerDiagnosis = Invoke-NodeManager -Action diagnose
        $Steps.Add([pscustomobject]@{ step='worker-diagnose-fallback'; ok=$WorkerDiagnosis.ok; exitCode=$WorkerDiagnosis.exitCode; authority='local-storage-zero-cost-worker-fabric' })
        $WorkerRepair = Invoke-NodeManager -Action repair
        $Steps.Add([pscustomobject]@{ step='worker-repair-fallback'; ok=$WorkerRepair.ok; exitCode=$WorkerRepair.exitCode; authority='local-storage-zero-cost-worker-fabric' })
        if ($WorkerRepair.ok) {
            $WorkerRestart = Invoke-NodeManager -Action restart
            $Steps.Add([pscustomobject]@{ step='worker-restart-fallback'; ok=$WorkerRestart.ok; exitCode=$WorkerRestart.exitCode; authority='local-storage-zero-cost-worker-fabric' })
        }

        # Re-run the canonical Local Agent owners after dependency recovery. The
        # worker fallback itself never establishes Local Agent readiness.
        $RestRetry = Invoke-RestRepair
        $Steps.Add([pscustomobject]@{ step='rest-repair-after-worker-fallback'; ok=$RestRetry.ok; exitCode=$RestRetry.exitCode; authority='local-storage-local-agent-rest' })
        $McpRetry = Invoke-McpEstablishment
        $Steps.Add([pscustomobject]@{ step='mcp-establishment-after-worker-fallback'; ok=$McpRetry.ok; exitCode=$McpRetry.exitCode; authority='local-storage-local-agent-mcp' })
        $Final = Invoke-Acceptance
        $Steps.Add([pscustomobject]@{ step='acceptance-after-worker-fallback'; ok=$Final.ok; exitCode=$Final.exitCode; authority='agent-infrastructure-acceptance' })
    }
    $Repaired = $Final.ok
}

# Worker automation is useful supporting health, but it is not an admission gate for
# Chat Local Agent readiness. Keep it observable without conflating queue health with
# current MCP/REST acceptance.
$WorkerStatus = Invoke-NodeManager -Action status
$Steps.Add([pscustomobject]@{ step='worker-status-observation'; ok=$WorkerStatus.ok; exitCode=$WorkerStatus.exitCode; authority='local-storage-zero-cost-worker-fabric'; admissionGate=$false })

$Receipt = [ordered]@{
    schemaVersion=1
    kind='evavo-chat-local-agent-readiness-v1'
    ok=[bool]$Final.ok
    repaired=[bool]$Repaired
    repairAttempted=[bool](-not $Initial.ok -and -not $NoRepair)
    noRepairRequested=[bool]$NoRepair
    canonicalLocalRepairAttempted=$CanonicalLocalRepairAttempted
    canonicalRestRepairAuthority='REPAIR-EVAVO-LOCAL-AGENT-REST-043.ps1'
    canonicalMcpRepairAuthority='START-EVAVO-LOCAL-AGENT-MCP-043.ps1'
    workerRecoveryIsSecondaryFallback=$true
    workerFallbackAttempted=$WorkerFallbackAttempted
    workerAutomationHealthIsNotLocalAgentAdmissionGate=$true
    workerAutomationHealthyObserved=[bool]$WorkerStatus.ok
    operatorExecutionRequested=[bool]$IncludeOperatorExecution
    workstationAcceptanceRequested=[bool]$IncludeWorkstationAcceptance
    loopbackRest='http://127.0.0.1:4329'
    canonicalMcp='mcp-server/local-agent-mcp.mjs'
    localStorageNodeManager='scripts/manage-autonomous-node.ps1'
    startedAt=$StartedAt.ToString('O')
    completedAt=[DateTimeOffset]::UtcNow.ToString('O')
    steps=@($Steps)
    automaticRetryCount=$(if($Initial.ok){0}elseif($WorkerFallbackAttempted){2}else{1})
    localAgentAcceptanceRequiredForSuccess=$true
    workerRepairAloneCanProveLocalAgentReady=$false
    restRuntimeExpectedHost='pythonw.exe'
    directConsolePythonTaskAllowed=$false
    permanentDeleteAuthorityAdded=$false
    childPowerShellHidden=$true
    focusStealAllowed=$false
    desktopCommanderRequired=$false
    githubActionsRequired=$false
    selfHostedActionsRunnerRequired=$false
    paidComputeRequired=$false
    credentialValuesReturned=$false
    physicalPathsReturned=$false
}
if ($Json) { $Receipt | ConvertTo-Json -Depth 10 } else { $Receipt }
if (-not $Receipt.ok) { exit 1 }
