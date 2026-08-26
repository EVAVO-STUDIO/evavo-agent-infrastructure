[CmdletBinding()]
param(
    [switch]$ProbeOpenAiTunnelDoctor,
    [switch]$ProbeRestHealth
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($env:OS-ne'Windows_NT'){throw'EVAVO_REMOTE_ACCESS_STATUS_WINDOWS_REQUIRED'}

$Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$TunnelStatus=Join-Path $PSScriptRoot 'Get-EvavoChatGPTWorkstationObserverTunnelStatus.ps1'
$Observer=Join-Path $Root 'mcp-server\workstation-observer-mcp.mjs'
foreach($Path in @($TunnelStatus,$Observer)){if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "EVAVO_REMOTE_ACCESS_STATUS_SOURCE_MISSING:$Path"}}
$PowerShell=(Get-Command powershell.exe -CommandType Application -ErrorAction Stop).Source

function Invoke-JsonScript {
  param([string]$Script,[string[]]$Arguments=@())
  $Raw=(&$PowerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Script @Arguments 2>&1|Out-String).Trim()
  if($LASTEXITCODE-ne0-or-not$Raw){return $null}
  try{return($Raw|ConvertFrom-Json -ErrorAction Stop)}catch{return $null}
}

$TunnelArgs=@()
if($ProbeOpenAiTunnelDoctor){$TunnelArgs+='-ProbeDoctor'}
$OpenAi=Invoke-JsonScript -Script $TunnelStatus -Arguments $TunnelArgs

$LocalStorage=$null
$Local=$env:LOCALAPPDATA
$GitRoot=if($env:EVAVO_GIT_ROOT){$env:EVAVO_GIT_ROOT}else{'C:\GitRepos'}
$Candidates=@(
  (Join-Path $Local 'EVAVO\WorkerControlPlane\zero-cost-updater\runtime\evavo-local-storage'),
  (Join-Path $Local 'EVAVO\WorkerControlPlane\zero-cost-recovery\runtime\evavo-local-storage'),
  (Join-Path $Local 'EVAVO\WorkerControlPlane\zero-cost-logon-guardian\runtime\evavo-local-storage'),
  (Join-Path $GitRoot 'evavo-local-storage')
)
foreach($Candidate in $Candidates){if(Test-Path -LiteralPath (Join-Path $Candidate 'scripts\Get-EvavoZeroCostWorkerAutomationStatus.ps1') -PathType Leaf){$LocalStorage=$Candidate;break}}

$Automation=$null;$Relay=$null;$Rest=$null
if($LocalStorage){
  $Automation=Invoke-JsonScript -Script (Join-Path $LocalStorage 'scripts\Get-EvavoZeroCostWorkerAutomationStatus.ps1')
  $Relay=Invoke-JsonScript -Script (Join-Path $LocalStorage 'scripts\Get-EvavoRemoteMcpRelayClientStatus.ps1')
  if($ProbeRestHealth){
    $Rest=Invoke-JsonScript -Script (Join-Path $LocalStorage 'scripts\Invoke-EvavoRestExecutor.ps1') -Arguments @('-Health','-BaseUrl','http://localhost:5000','-TimeoutSeconds','10')
  }
}

$OpenAiInstalled=[bool]($OpenAi-and$OpenAi.ok-eq$true)
$OpenAiReachable=[bool]($OpenAi-and$OpenAi.doctorAttempted-eq$true-and$OpenAi.doctorPassed-eq$true)
$RelayConfigured=[bool]($Relay-and$Relay.configured-eq$true)
$RelayTaskHealthy=[bool]($Relay-and$Relay.ok-eq$true)
$AutomationHealthy=[bool]($Automation-and$Automation.ok-eq$true)
$RestHealthy=[bool]($Rest-and[string]$Rest.status-eq'healthy'-and[string]$Rest.version-eq'5.0.0'-and[int]$Rest.api_revision-ge2)

[ordered]@{
 schemaVersion=1
 kind='evavo-remote-workstation-access-status-v1'
 ok=[bool]($AutomationHealthy-or$OpenAiInstalled-or$RelayTaskHealthy-or$RestHealthy)
 checkedAt=[DateTimeOffset]::UtcNow.ToString('o')
 localStorageSourceAvailable=[bool]$LocalStorage
 localStorageSourcePathReturned=$false
 workerAutomation=[ordered]@{
   available=[bool]$Automation
   healthy=$AutomationHealthy
   physicalAcceptanceClaimed=if($Automation){[bool]$Automation.physicalAcceptanceClaimed}else{$false}
 }
 openAiSecureMcpTunnel=[ordered]@{
   installed=$OpenAiInstalled
   doctorAttempted=[bool]($OpenAi-and$OpenAi.doctorAttempted)
   doctorPassed=[bool]($OpenAi-and$OpenAi.doctorPassed)
   physicallyReachableClaimed=$OpenAiReachable
   repositoryIndependentObserver=[bool]($OpenAi-and$OpenAi.observerBundle.repositoryIndependent)
   tunnelIdReturned=$false
   runtimeKeyReturned=$false
   chatGptConnectorRegistrationClaimed=$false
 }
 cloudflareRelay=[ordered]@{
   configured=$RelayConfigured
   localTaskHealthy=$RelayTaskHealthy
   cloudConnectionClaimed=$false
   endpointReturned=$false
   tokenReturned=$false
   effectfulDispatchReadyClaimed=$false
 }
 restExecutor=[ordered]@{
   probeAttempted=[bool]$ProbeRestHealth
   healthy=$RestHealthy
   loopbackOnly=$true
   commandExecuted=$false
 }
 networkProbePerformed=[bool]($ProbeOpenAiTunnelDoctor-or$ProbeRestHealth)
 repairPerformed=$false
 arbitraryShellExposed=$false
 credentialValuesReturned=$false
 githubActionsRequired=$false
 vercelRequired=$false
 physicalWorkstationExecutionClaimed=$false
}|ConvertTo-Json -Depth 12
