[CmdletBinding()]
param(
    [switch]$ProvisionCloudflareRelay,
    [switch]$StartNow,
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($env:OS-ne'Windows_NT'){throw'EVAVO_REMOTE_ACCESS_INSTALL_WINDOWS_REQUIRED'}
if(-not$env:LOCALAPPDATA){throw'EVAVO_REMOTE_ACCESS_INSTALL_LOCALAPPDATA_REQUIRED'}

$Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$PowerShell=(Get-Command powershell.exe -CommandType Application -ErrorAction Stop).Source
$TunnelV3=Join-Path $PSScriptRoot 'Install-EvavoChatGPTWorkstationObserverTunnelV3.ps1'
$RelayDeploy=Join-Path $PSScriptRoot 'Deploy-EvavoRemoteMcpRelayV2.ps1'
foreach($Path in @($TunnelV3,$RelayDeploy)){if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "EVAVO_REMOTE_ACCESS_INSTALL_SOURCE_MISSING:$Path"}}
foreach($Path in @($TunnelV3,$RelayDeploy)){$t=$null;$e=$null;[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$t,[ref]$e)|Out-Null;if(@($e).Count-gt0){throw "EVAVO_REMOTE_ACCESS_INSTALL_PARSE_FAILED:$Path"}}

$GitRoot=if($env:EVAVO_GIT_ROOT){$env:EVAVO_GIT_ROOT}else{'C:\GitRepos'}
$LocalStorageCandidates=@(
  (Join-Path $env:LOCALAPPDATA 'EVAVO\WorkerControlPlane\zero-cost-updater\runtime\evavo-local-storage'),
  (Join-Path $env:LOCALAPPDATA 'EVAVO\WorkerControlPlane\zero-cost-recovery\runtime\evavo-local-storage'),
  (Join-Path $env:LOCALAPPDATA 'EVAVO\WorkerControlPlane\zero-cost-logon-guardian\runtime\evavo-local-storage'),
  (Join-Path $GitRoot 'evavo-local-storage')
)
$LocalStorage=$null
foreach($Candidate in $LocalStorageCandidates){if(Test-Path -LiteralPath (Join-Path $Candidate 'INSTALL-EVAVO-ZERO-COST-WORKER-AUTOMATION.ps1') -PathType Leaf){$LocalStorage=$Candidate;break}}
if(-not$LocalStorage){throw'EVAVO_REMOTE_ACCESS_INSTALL_LOCAL_STORAGE_UNAVAILABLE'}

function Invoke-JsonPowerShell {
  param([string]$Script,[hashtable]$Named=@{})
  $Raw=(& $Script @Named | Out-String).Trim()
  if(-not$Raw){throw "EVAVO_REMOTE_ACCESS_INSTALL_EMPTY_RECEIPT:$Script"}
  try{return($Raw|ConvertFrom-Json -ErrorAction Stop)}catch{throw "EVAVO_REMOTE_ACCESS_INSTALL_INVALID_RECEIPT:$Script"}
}

$Started=[DateTimeOffset]::UtcNow
$Bootstrap=$null;$Tunnel=$null;$Cloudflare=$null;$TunnelSkip=$null;$CloudflareSkip=$null

$BootstrapScript=Join-Path $LocalStorage 'INSTALL-EVAVO-ZERO-COST-WORKER-AUTOMATION.ps1'
$Bootstrap=Invoke-JsonPowerShell -Script $BootstrapScript -Named @{Repository='EVAVO-STUDIO/evavo-local-storage';StartNow=$StartNow}
if([string]$Bootstrap.kind-ne'evavo-zero-cost-worker-automation-bootstrap'-or$Bootstrap.ok-ne$true-or$Bootstrap.minimumRecoveryPlanesInstalled-lt2){throw'EVAVO_REMOTE_ACCESS_INSTALL_BOOTSTRAP_NOT_ACCEPTED'}

$TunnelClient=Get-Command tunnel-client.exe,tunnel-client -CommandType Application -ErrorAction SilentlyContinue|Select-Object -First 1
$TunnelId=[Environment]::GetEnvironmentVariable('EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID','User')
if([string]::IsNullOrWhiteSpace($TunnelId)){$TunnelId=[string]$env:EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID}
$RuntimeKey=[Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','User')
if([string]::IsNullOrWhiteSpace($RuntimeKey)){$RuntimeKey=[string]$env:CONTROL_PLANE_API_KEY}
if([string]::IsNullOrWhiteSpace($RuntimeKey)){$RuntimeKey=[Environment]::GetEnvironmentVariable('OPENAI_API_KEY','User')}
if([string]::IsNullOrWhiteSpace($RuntimeKey)){$RuntimeKey=[string]$env:OPENAI_API_KEY}
$Admin=[Environment]::GetEnvironmentVariable('OPENAI_ADMIN_KEY','User')
if([string]::IsNullOrWhiteSpace($Admin)){$Admin=[string]$env:OPENAI_ADMIN_KEY}
$Workspace=[string]$env:OPENAI_WORKSPACE_ID;$Organization=[string]$env:OPENAI_ORGANIZATION_ID
$CanUseExistingTunnel=[bool]($TunnelClient-and$RuntimeKey-and$TunnelId-match'^tunnel_[0-9a-f]{32}$')
$CanCreateTunnel=[bool]($TunnelClient-and$RuntimeKey-and$Admin-and($Workspace-or$Organization))
if($CanUseExistingTunnel-or$CanCreateTunnel){
  $TunnelArgs=@{StartNow=$StartNow;Json=$true}
  if($CanCreateTunnel-and-not$CanUseExistingTunnel){$TunnelArgs.CreateTunnelIfMissing=$true;if($Workspace){$TunnelArgs.WorkspaceId=$Workspace};if($Organization){$TunnelArgs.OrganizationId=$Organization}}
  $Tunnel=Invoke-JsonPowerShell -Script $TunnelV3 -Named $TunnelArgs
  if([string]$Tunnel.kind-ne'evavo-chatgpt-workstation-observer-tunnel-installation-v3'-or$Tunnel.ok-ne$true-or$Tunnel.backgroundTaskAuthenticationReady-ne$true-or$Tunnel.repositoryIndependentObserver-ne$true){throw'EVAVO_REMOTE_ACCESS_INSTALL_TUNNEL_NOT_ACCEPTED'}
}else{$TunnelSkip=if(-not$TunnelClient){'tunnel-client-unavailable'}elseif(-not$RuntimeKey){'runtime-key-unavailable'}else{'tunnel-id-or-admin-scope-unavailable'}}

if($ProvisionCloudflareRelay){
  $Cloudflare=Invoke-JsonPowerShell -Script $RelayDeploy
  if([string]$Cloudflare.kind-ne'evavo-remote-mcp-relay-deployment-v2'-or$Cloudflare.ok-ne$true-or$Cloudflare.cloudflareCredentialValueReturned-ne$false-or$Cloudflare.existingProviderCredentialReused-ne$true){throw'EVAVO_REMOTE_ACCESS_INSTALL_CLOUDFLARE_NOT_ACCEPTED'}
}else{$CloudflareSkip='not-requested'}

$Receipt=[ordered]@{
  schemaVersion=3
  kind='evavo-remote-workstation-access-installation'
  ok=$true
  startedAt=$Started.ToString('o')
  completedAt=[DateTimeOffset]::UtcNow.ToString('o')
  localStorageBootstrap=$Bootstrap
  minimumLocalRecoveryPlanesInstalled=[int]$Bootstrap.minimumRecoveryPlanesInstalled
  openAiSecureMcpTunnel=$Tunnel
  openAiSecureMcpTunnelSkippedReason=$TunnelSkip
  openAiTunnelTaskStarted=if($Tunnel){[bool]$Tunnel.started}else{$false}
  openAiTunnelStartIsPhysicalReachabilityProof=$false
  cloudflareRelay=$Cloudflare
  cloudflareRelaySkippedReason=$CloudflareSkip
  cloudflareProvisionExplicitlyRequested=[bool]$ProvisionCloudflareRelay
  cloudflareExistingCredentialSourceReused=if($Cloudflare){[bool]$Cloudflare.existingProviderCredentialReused}else{$false}
  cloudflareCredentialSourceCategory=if($Cloudflare){[string]$Cloudflare.credentialSourceCategory}else{$null}
  cloudflareAccountSourceCategory=if($Cloudflare){[string]$Cloudflare.accountSourceCategory}else{$null}
  openAiCredentialValuesReturned=$false
  cloudflareCredentialValuesReturned=$false
  cloudflareAccountIdReturned=$false
  arbitraryShellExposed=$false
  githubActionsRequired=$false
  vercelRequired=$false
  developmentCheckoutRequiredAfterEstablishment=$false
  physicalRemoteReachabilityClaimed=[bool]($Cloudflare-and$Cloudflare.physicalWorkstationConnectionProven)
}
$RuntimeKey=$null;$Admin=$null
$Receipt|ConvertTo-Json -Depth 20
