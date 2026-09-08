[CmdletBinding()]
param(
    [switch]$ProbeOpenAiTunnelDoctor,
    [switch]$ProbeRestHealth,
    [switch]$ProbeProviderCliAuth
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($env:OS-ne'Windows_NT'){throw'EVAVO_REMOTE_ACCESS_STATUS_WINDOWS_REQUIRED'}

$Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$ObserverTunnelStatus=Join-Path $PSScriptRoot 'Get-EvavoChatGPTWorkstationObserverTunnelStatus.ps1'
$ExecutionTunnelStatus=Join-Path $PSScriptRoot 'Get-EvavoChatGPTWindowsExecutionTunnelStatus.ps1'
$ProviderStatus=Join-Path $PSScriptRoot 'Get-EvavoProviderCredentialReadiness.ps1'
$Observer=Join-Path $Root 'mcp-server\workstation-observer-mcp.mjs'
$ExecutionMcp=Join-Path $Root 'mcp-server\windows-chat-execution-mcp.mjs'
foreach($Path in @($ObserverTunnelStatus,$ExecutionTunnelStatus,$ProviderStatus,$Observer,$ExecutionMcp)){if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "EVAVO_REMOTE_ACCESS_STATUS_SOURCE_MISSING:$Path"}}
$PowerShell=(Get-Command powershell.exe -CommandType Application -ErrorAction Stop).Source

function Invoke-JsonScript {
  param([string]$Script,[string[]]$Arguments=@())
  $Previous=$ErrorActionPreference
  try{$ErrorActionPreference='Continue';$Raw=(&$PowerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Script @Arguments 2>&1|Out-String).Trim();$Code=[int]$LASTEXITCODE}finally{$ErrorActionPreference=$Previous}
  if($Code-ne0-or-not$Raw){return $null}
  try{return($Raw|ConvertFrom-Json -ErrorAction Stop)}catch{return $null}
}

$ObserverArgs=@();$ExecutionArgs=@()
if($ProbeOpenAiTunnelDoctor){$ObserverArgs+='-ProbeDoctor';$ExecutionArgs+='-ProbeTunnelDoctor'}
$OpenAiObserver=Invoke-JsonScript -Script $ObserverTunnelStatus -Arguments $ObserverArgs
$OpenAiExecution=Invoke-JsonScript -Script $ExecutionTunnelStatus -Arguments $ExecutionArgs
$ProviderArgs=@();if($ProbeProviderCliAuth){$ProviderArgs+='-ProbeCliAuth'}
$Providers=Invoke-JsonScript -Script $ProviderStatus -Arguments $ProviderArgs

$LocalStorage=$null;$Local=$env:LOCALAPPDATA;$GitRoot=if($env:EVAVO_GIT_ROOT){$env:EVAVO_GIT_ROOT}else{'C:\GitRepos'}
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
  if($ProbeRestHealth){$Rest=Invoke-JsonScript -Script (Join-Path $LocalStorage 'scripts\Invoke-EvavoRestExecutor.ps1') -Arguments @('-Health','-BaseUrl','http://localhost:5000','-TimeoutSeconds','10')}
}

# Installation/configuration state and runtime reachability are deliberately separate.
# Child status receipts now expose executionReadyByInstalledState so a failed doctor
# probe cannot make a genuinely installed route disappear from inventory.
$ObserverInstalled=[bool]($OpenAiObserver-and$OpenAiObserver.executionReadyByInstalledState-eq$true)
$ObserverReachable=[bool]($OpenAiObserver-and$OpenAiObserver.runtimeReadinessProbed-eq$true-and$OpenAiObserver.runtimeReady-eq$true)
$ExecutionInstalled=[bool]($OpenAiExecution-and$OpenAiExecution.executionReadyByInstalledState-eq$true)
$ExecutionDoctorPassed=[bool]($OpenAiExecution-and$OpenAiExecution.runtimeReadinessProbed-eq$true-and$OpenAiExecution.runtimeReady-eq$true)
$RelayConfigured=[bool]($Relay-and$Relay.configured-eq$true)
$RelayTaskHealthy=[bool]($Relay-and$Relay.ok-eq$true)
$AutomationHealthy=[bool]($Automation-and$Automation.ok-eq$true)
$RestHealthy=[bool]($Rest-and[string]$Rest.status-eq'healthy'-and[string]$Rest.version-eq'5.0.0'-and[int]$Rest.api_revision-ge2)

$OpenAiTunnelProbePassed=[bool](
  $ProbeOpenAiTunnelDoctor-and(
    ($ObserverInstalled-and$ObserverReachable)-or
    ($ExecutionInstalled-and$ExecutionDoctorPassed)
  )
)

$ProviderProbeAttemptedCount=0
$ProviderProbePassedCount=0
$ProviderProbeFailedCount=0
if($Providers){
  foreach($Provider in @($Providers.github,$Providers.cloudflare,$Providers.vercel)){
    if($Provider-and$Provider.authProbeAttempted-eq$true){
      $ProviderProbeAttemptedCount++
      if($Provider.authProbePassed-eq$true){$ProviderProbePassedCount++}else{$ProviderProbeFailedCount++}
    }
  }
}
$ProviderCliAuthProbePassed=[bool](
  $ProbeProviderCliAuth-and
  $ProviderProbeAttemptedCount-gt0-and
  $ProviderProbeFailedCount-eq0
)

$AccessSurfaceReady=[bool]($AutomationHealthy-or$ObserverInstalled-or$ExecutionInstalled-or$RelayTaskHealthy-or$RestHealthy)
$RuntimeProbeRequested=[bool]($ProbeOpenAiTunnelDoctor-or$ProbeRestHealth-or$ProbeProviderCliAuth)
$RequestedChecksPassed=[bool](
  (-not$ProbeOpenAiTunnelDoctor-or$OpenAiTunnelProbePassed)-and
  (-not$ProbeRestHealth-or$RestHealthy)-and
  (-not$ProbeProviderCliAuth-or$ProviderCliAuthProbePassed)
)
$OverallReady=[bool]($AccessSurfaceReady-and$RequestedChecksPassed)

[ordered]@{
 schemaVersion=4
 kind='evavo-remote-workstation-access-status-v4'
 ok=$OverallReady
 checkedAt=[DateTimeOffset]::UtcNow.ToString('o')
 localStorageSourceAvailable=[bool]$LocalStorage
 localStorageSourcePathReturned=$false
 accessSurfaceReady=$AccessSurfaceReady
 runtimeProbeRequested=$RuntimeProbeRequested
 requestedChecksPassed=$RequestedChecksPassed
 readinessBasis=if($RuntimeProbeRequested){'available-access-surface-and-all-requested-checks'}else{'available-access-surface'}
 providerReadiness=if($Providers){[ordered]@{
   available=$true
   cliAuthProbeRequested=[bool]$ProbeProviderCliAuth
   cliAuthProbeAttemptedCount=$ProviderProbeAttemptedCount
   cliAuthProbePassedCount=$ProviderProbePassedCount
   cliAuthProbeFailedCount=$ProviderProbeFailedCount
   cliAuthProbePassed=if($ProbeProviderCliAuth){$ProviderCliAuthProbePassed}else{$null}
   github=[ordered]@{cliAvailable=[bool]$Providers.github.cliAvailable;authProbeAttempted=[bool]$Providers.github.authProbeAttempted;authProbePassed=[bool]$Providers.github.authProbePassed}
   cloudflare=[ordered]@{wranglerAvailable=[bool]$Providers.cloudflare.wranglerAvailable;authProbeAttempted=[bool]$Providers.cloudflare.authProbeAttempted;authProbePassed=[bool]$Providers.cloudflare.authProbePassed;credentialSourceCategory=[string]$Providers.cloudflare.credentialSourceCategory;accountSourceCategory=[string]$Providers.cloudflare.accountSourceCategory}
   openAi=[ordered]@{tunnelClientAvailable=[bool]$Providers.openAi.tunnelClientAvailable;runtimeCredentialConfigured=[bool]$Providers.openAi.runtimeCredentialConfigured;runtimeCredentialSourceCategory=[string]$Providers.openAi.runtimeCredentialSourceCategory;adminCredentialConfigured=[bool]$Providers.openAi.adminCredentialConfigured;workspaceOrOrganizationScopeConfigured=[bool]$Providers.openAi.workspaceOrOrganizationScopeConfigured;tunnelIdConfigured=[bool]$Providers.openAi.tunnelIdConfigured}
   vercel=[ordered]@{cliAvailable=[bool]$Providers.vercel.cliAvailable;authProbeAttempted=[bool]$Providers.vercel.authProbeAttempted;authProbePassed=[bool]$Providers.vercel.authProbePassed}
   credentialValuesReturned=$false;environmentValuesReturned=$false
 }}else{[ordered]@{
   available=$false
   cliAuthProbeRequested=[bool]$ProbeProviderCliAuth
   cliAuthProbeAttemptedCount=0
   cliAuthProbePassedCount=0
   cliAuthProbeFailedCount=0
   cliAuthProbePassed=if($ProbeProviderCliAuth){$false}else{$null}
   credentialValuesReturned=$false
   environmentValuesReturned=$false
 }}
 workerAutomation=[ordered]@{available=[bool]$Automation;healthy=$AutomationHealthy;physicalAcceptanceClaimed=if($Automation){[bool]$Automation.physicalAcceptanceClaimed}else{$false}}
 openAiSecureMcpObserverTunnel=[ordered]@{
   installed=$ObserverInstalled
   doctorRequested=[bool]$ProbeOpenAiTunnelDoctor
   doctorAttempted=[bool]($OpenAiObserver-and$OpenAiObserver.doctorAttempted)
   doctorPassed=[bool]($OpenAiObserver-and$OpenAiObserver.doctorPassed)
   runtimeReady=$ObserverReachable
   physicallyReachableClaimed=$ObserverReachable
   repositoryIndependentObserver=[bool]($OpenAiObserver-and$OpenAiObserver.observerBundle.repositoryIndependent)
   readOnly=$true
   arbitraryShellExposed=$false
   tunnelIdReturned=$false
   runtimeKeyReturned=$false
   chatGptConnectorRegistrationClaimed=$false
 }
 openAiSecureMcpWindowsExecutionTunnel=[ordered]@{
   installed=$ExecutionInstalled
   bundleIntegrity=[bool]($OpenAiExecution-and$OpenAiExecution.bundleIntegrity)
   taskExact=[bool]($OpenAiExecution-and$OpenAiExecution.taskExact)
   doctorRequested=[bool]$ProbeOpenAiTunnelDoctor
   doctorAttempted=[bool]($OpenAiExecution-and$OpenAiExecution.tunnelDoctorProbed)
   doctorPassed=$ExecutionDoctorPassed
   runtimeReady=$ExecutionDoctorPassed
   effectful=[bool]($OpenAiExecution-and$OpenAiExecution.effectful)
   rawShellExecutionRemoved=[bool]($OpenAiExecution-and$OpenAiExecution.rawShellExecutionRemoved)
   arbitraryCommandTextAccepted=[bool]($OpenAiExecution-and$OpenAiExecution.arbitraryCommandTextAccepted)
   inlineCodeAccepted=[bool]($OpenAiExecution-and$OpenAiExecution.inlineCodeAccepted)
   currentWindowsUserRawShellAuthorityExposed=[bool]($OpenAiExecution-and$OpenAiExecution.currentWindowsUserRawShellAuthorityExposed)
   productConnectorRegistrationClaimed=$false
   tunnelIdReturned=$false
   runtimeKeyReturned=$false
 }
 openAiTunnelProbe=[ordered]@{
   requested=[bool]$ProbeOpenAiTunnelDoctor
   passed=if($ProbeOpenAiTunnelDoctor){$OpenAiTunnelProbePassed}else{$null}
   passingRouteCount=if($ProbeOpenAiTunnelDoctor){[int]([bool]($ObserverInstalled-and$ObserverReachable))+[int]([bool]($ExecutionInstalled-and$ExecutionDoctorPassed))}else{$null}
 }
 cloudflareRelay=[ordered]@{configured=$RelayConfigured;localTaskHealthy=$RelayTaskHealthy;cloudConnectionClaimed=$false;endpointReturned=$false;tokenReturned=$false;effectfulDispatchReadyClaimed=$false}
 restExecutor=[ordered]@{probeAttempted=[bool]$ProbeRestHealth;healthy=$RestHealthy;probePassed=if($ProbeRestHealth){$RestHealthy}else{$null};loopbackOnly=$true;commandExecuted=$false}
 networkProbePerformed=[bool]($ProbeOpenAiTunnelDoctor-or$ProbeRestHealth-or$ProbeProviderCliAuth)
 repairPerformed=$false
 observerArbitraryShellExposed=$false
 windowsExecutionTunnelInstalled=$ExecutionInstalled
 windowsExecutionTunnelDoctorPassed=if($ProbeOpenAiTunnelDoctor){$ExecutionDoctorPassed}else{$null}
 arbitraryShellConfiguredLocally=$false
 arbitraryShellProvenReachableFromChat=$false
 credentialValuesReturned=$false
 environmentValuesReturned=$false
 githubActionsRequired=$false
 vercelRequired=$false
 physicalWorkstationExecutionClaimed=$false
}|ConvertTo-Json -Depth 14
