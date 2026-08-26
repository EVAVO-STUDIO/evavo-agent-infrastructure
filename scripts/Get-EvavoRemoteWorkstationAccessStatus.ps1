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

$ObserverInstalled=[bool]($OpenAiObserver-and$OpenAiObserver.ok-eq$true)
$ObserverReachable=[bool]($OpenAiObserver-and$OpenAiObserver.doctorAttempted-eq$true-and$OpenAiObserver.doctorPassed-eq$true)
$ExecutionInstalled=[bool]($OpenAiExecution-and$OpenAiExecution.bundleIntegrity-eq$true-and$OpenAiExecution.taskExact-eq$true)
$ExecutionDoctorPassed=[bool]($OpenAiExecution-and$OpenAiExecution.tunnelDoctorProbed-eq$true-and$OpenAiExecution.tunnelDoctorPassed-eq$true)
$RelayConfigured=[bool]($Relay-and$Relay.configured-eq$true);$RelayTaskHealthy=[bool]($Relay-and$Relay.ok-eq$true);$AutomationHealthy=[bool]($Automation-and$Automation.ok-eq$true)
$RestHealthy=[bool]($Rest-and[string]$Rest.status-eq'healthy'-and[string]$Rest.version-eq'5.0.0'-and[int]$Rest.api_revision-ge2)

[ordered]@{
 schemaVersion=3
 kind='evavo-remote-workstation-access-status-v3'
 ok=[bool]($AutomationHealthy-or$ObserverInstalled-or$ExecutionInstalled-or$RelayTaskHealthy-or$RestHealthy)
 checkedAt=[DateTimeOffset]::UtcNow.ToString('o')
 localStorageSourceAvailable=[bool]$LocalStorage
 localStorageSourcePathReturned=$false
 providerReadiness=if($Providers){[ordered]@{
   available=$true;cliAuthProbeRequested=[bool]$ProbeProviderCliAuth
   github=[ordered]@{cliAvailable=[bool]$Providers.github.cliAvailable;authProbeAttempted=[bool]$Providers.github.authProbeAttempted;authProbePassed=[bool]$Providers.github.authProbePassed}
   cloudflare=[ordered]@{wranglerAvailable=[bool]$Providers.cloudflare.wranglerAvailable;authProbeAttempted=[bool]$Providers.cloudflare.authProbeAttempted;authProbePassed=[bool]$Providers.cloudflare.authProbePassed;credentialSourceCategory=[string]$Providers.cloudflare.credentialSourceCategory;accountSourceCategory=[string]$Providers.cloudflare.accountSourceCategory}
   openAi=[ordered]@{tunnelClientAvailable=[bool]$Providers.openAi.tunnelClientAvailable;runtimeCredentialConfigured=[bool]$Providers.openAi.runtimeCredentialConfigured;runtimeCredentialSourceCategory=[string]$Providers.openAi.runtimeCredentialSourceCategory;adminCredentialConfigured=[bool]$Providers.openAi.adminCredentialConfigured;workspaceOrOrganizationScopeConfigured=[bool]$Providers.openAi.workspaceOrOrganizationScopeConfigured;tunnelIdConfigured=[bool]$Providers.openAi.tunnelIdConfigured}
   vercel=[ordered]@{cliAvailable=[bool]$Providers.vercel.cliAvailable;authProbeAttempted=[bool]$Providers.vercel.authProbeAttempted;authProbePassed=[bool]$Providers.vercel.authProbePassed}
   credentialValuesReturned=$false;environmentValuesReturned=$false
 }}else{[ordered]@{available=$false;credentialValuesReturned=$false;environmentValuesReturned=$false}}
 workerAutomation=[ordered]@{available=[bool]$Automation;healthy=$AutomationHealthy;physicalAcceptanceClaimed=if($Automation){[bool]$Automation.physicalAcceptanceClaimed}else{$false}}
 openAiSecureMcpObserverTunnel=[ordered]@{
   installed=$ObserverInstalled;doctorAttempted=[bool]($OpenAiObserver-and$OpenAiObserver.doctorAttempted);doctorPassed=[bool]($OpenAiObserver-and$OpenAiObserver.doctorPassed);physicallyReachableClaimed=$ObserverReachable
   repositoryIndependentObserver=[bool]($OpenAiObserver-and$OpenAiObserver.observerBundle.repositoryIndependent);readOnly=$true;arbitraryShellExposed=$false;tunnelIdReturned=$false;runtimeKeyReturned=$false;chatGptConnectorRegistrationClaimed=$false
 }
 openAiSecureMcpWindowsExecutionTunnel=[ordered]@{
   installed=$ExecutionInstalled;bundleIntegrity=[bool]($OpenAiExecution-and$OpenAiExecution.bundleIntegrity);taskExact=[bool]($OpenAiExecution-and$OpenAiExecution.taskExact)
   doctorAttempted=[bool]($OpenAiExecution-and$OpenAiExecution.tunnelDoctorProbed);doctorPassed=$ExecutionDoctorPassed
   effectful=[bool]($OpenAiExecution-and$OpenAiExecution.effectful);arbitraryCommandTextAccepted=[bool]($OpenAiExecution-and$OpenAiExecution.arbitraryCommandTextAccepted);currentWindowsUserAuthority=[bool]($OpenAiExecution-and$OpenAiExecution.currentWindowsUserAuthority)
   supportedShells=if($OpenAiExecution){@($OpenAiExecution.supportedShells)}else{@()};maximumInteractiveSeconds=if($OpenAiExecution){$OpenAiExecution.maximumInteractiveSeconds}else{$null};acceptedRestExecutorAttestationRequired=[bool]($OpenAiExecution-and$OpenAiExecution.acceptedRestExecutorAttestationRequired)
   productConnectorRegistrationClaimed=$false;tunnelIdReturned=$false;runtimeKeyReturned=$false
 }
 cloudflareRelay=[ordered]@{configured=$RelayConfigured;localTaskHealthy=$RelayTaskHealthy;cloudConnectionClaimed=$false;endpointReturned=$false;tokenReturned=$false;effectfulDispatchReadyClaimed=$false}
 restExecutor=[ordered]@{probeAttempted=[bool]$ProbeRestHealth;healthy=$RestHealthy;loopbackOnly=$true;commandExecuted=$false}
 networkProbePerformed=[bool]($ProbeOpenAiTunnelDoctor-or$ProbeRestHealth-or$ProbeProviderCliAuth)
 repairPerformed=$false
 observerArbitraryShellExposed=$false
 windowsExecutionTunnelInstalled=$ExecutionInstalled
 windowsExecutionTunnelDoctorPassed=if($ProbeOpenAiTunnelDoctor){$ExecutionDoctorPassed}else{$null}
 arbitraryShellConfiguredLocally=$ExecutionInstalled
 arbitraryShellProvenReachableFromChat=$false
 credentialValuesReturned=$false
 environmentValuesReturned=$false
 githubActionsRequired=$false
 vercelRequired=$false
 physicalWorkstationExecutionClaimed=$false
}|ConvertTo-Json -Depth 14
