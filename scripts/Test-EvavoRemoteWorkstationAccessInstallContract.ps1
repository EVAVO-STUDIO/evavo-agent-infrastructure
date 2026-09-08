[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$Installer=Join-Path $PSScriptRoot 'Install-EvavoRemoteWorkstationAccess.ps1'
$Status=Join-Path $PSScriptRoot 'Get-EvavoRemoteWorkstationAccessStatus.ps1'
$ObserverTunnel=Join-Path $PSScriptRoot 'Install-EvavoChatGPTWorkstationObserverTunnelV3.ps1'
$ExecutionTunnel=Join-Path $PSScriptRoot 'Install-EvavoChatGPTWindowsExecutionTunnel.ps1'
$Relay=Join-Path $PSScriptRoot 'Deploy-EvavoRemoteMcpRelayV2.ps1'
$RelayV1=Join-Path $PSScriptRoot 'Deploy-EvavoRemoteMcpRelay.ps1'
foreach($Path in @($Installer,$Status,$ObserverTunnel,$ExecutionTunnel,$Relay,$RelayV1)){if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "EVAVO_REMOTE_ACCESS_CONTRACT_MISSING:$Path"};$t=$null;$e=$null;[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$t,[ref]$e)|Out-Null;if(@($e).Count-gt0){throw "EVAVO_REMOTE_ACCESS_CONTRACT_PARSE_FAILED:$Path"}}
$Source=Get-Content -LiteralPath $Installer -Raw -Encoding UTF8
$StatusSource=Get-Content -LiteralPath $Status -Raw -Encoding UTF8
$ObserverSource=Get-Content -LiteralPath $ObserverTunnel -Raw -Encoding UTF8
$ExecutionSource=Get-Content -LiteralPath $ExecutionTunnel -Raw -Encoding UTF8
$RelaySource=Get-Content -LiteralPath $Relay -Raw -Encoding UTF8
foreach($Needle in @(
 'INSTALL-EVAVO-ZERO-COST-WORKER-AUTOMATION.ps1',
 'Install-EvavoChatGPTWorkstationObserverTunnelV3.ps1',
 'Install-EvavoChatGPTWindowsExecutionTunnel.ps1',
 'Deploy-EvavoRemoteMcpRelayV2.ps1',
 'EnableWindowsExecution',
 'windowsExecutionCompatibilityExplicitlyRequested',
 'windowsExecutionCompatibilityEstablished',
 'windowsExecutionEstablished=$false',
 'effectfulWorkstationToolsExposed=$false',
 'rawShellExecutionRemoved=$true',
 'arbitraryCommandTextAccepted=$false',
 'inlineCodeAccepted=$false',
 "canonicalStructuredExecutor='EVAVO-STUDIO/evavo-local-compute'",
 "canonicalHostedEffectfulRoutes=@('cloudflare-typed-relay','github-issue-queue')",
 'observerArbitraryShellExposed=$false',
 'compatibilityTunnelArbitraryShellExposed=$false',
 'cloudflareProvisionExplicitlyRequested',
 'openAiCredentialValuesReturned=$false',
 'cloudflareCredentialValuesReturned=$false',
 'githubActionsRequired=$false'
)){if(-not$Source.Contains($Needle)){throw "EVAVO_REMOTE_ACCESS_CONTRACT_MISSING_RULE:$Needle"}}
foreach($Needle in @(
 'observerReadOnly=$true',
 'effectfulWorkstationToolsExposed=$false'
)){if(-not$ObserverSource.Contains($Needle)){throw "EVAVO_REMOTE_ACCESS_CONTRACT_OBSERVER_BOUNDARY_MISSING:$Needle"}}
foreach($Needle in @(
 'effectfulWorkstationToolsExposed=$false',
 'rawShellExecutionRemoved=$true',
 'arbitraryCommandTextAccepted=$false',
 'inlineCodeAccepted=$false',
 'currentWindowsUserRawShellAuthorityExposed=$false',
 "canonicalStructuredExecutor='EVAVO-STUDIO/evavo-local-compute'",
 "canonicalWorkstationBridge='evavo-windows-workstation-bridge'",
 "effectfulCloudFallbacks=@('cloudflare-typed-relay','github-issue-queue')",
 'localPublicListenerRequired=$false',
 'outboundOnly=$true'
)){if(-not$ExecutionSource.Contains($Needle)){throw "EVAVO_REMOTE_ACCESS_CONTRACT_EXECUTION_RULE_MISSING:$Needle"}}
foreach($Needle in @(
 'CLOUDFLARE_API_TOKEN','CF_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','CF_ACCOUNT_ID',
 'cloudflareCredentialValueReturned=$false','cloudflareAccountIdReturned=$false','credentialPersistedByThisWrapper=$false'
)){if(-not$RelaySource.Contains($Needle)){throw "EVAVO_REMOTE_ACCESS_CONTRACT_CLOUDFLARE_RULE_MISSING:$Needle"}}
foreach($Needle in @(
 'schemaVersion=4',
 "kind='evavo-remote-workstation-access-status-v4'",
 '$ObserverInstalled=[bool]($OpenAiObserver-and$OpenAiObserver.executionReadyByInstalledState-eq$true)',
 '$ObserverReachable=[bool]($OpenAiObserver-and$OpenAiObserver.runtimeReadinessProbed-eq$true-and$OpenAiObserver.runtimeReady-eq$true)',
 '$ExecutionInstalled=[bool]($OpenAiExecution-and$OpenAiExecution.executionReadyByInstalledState-eq$true)',
 '$ExecutionDoctorPassed=[bool]($OpenAiExecution-and$OpenAiExecution.runtimeReadinessProbed-eq$true-and$OpenAiExecution.runtimeReady-eq$true)',
 '$ProviderProbeAttemptedCount=0',
 '$ProviderProbeFailedCount=0',
 '$AccessSurfaceReady=[bool]($AutomationHealthy-or$ObserverInstalled-or$ExecutionInstalled-or$RelayTaskHealthy-or$RestHealthy)',
 '$RuntimeProbeRequested=[bool]($ProbeOpenAiTunnelDoctor-or$ProbeRestHealth-or$ProbeProviderCliAuth)',
 '$RequestedChecksPassed=[bool](',
 '(-not$ProbeOpenAiTunnelDoctor-or$OpenAiTunnelProbePassed)',
 '(-not$ProbeRestHealth-or$RestHealthy)',
 '(-not$ProbeProviderCliAuth-or$ProviderCliAuthProbePassed)',
 '$OverallReady=[bool]($AccessSurfaceReady-and$RequestedChecksPassed)',
 'ok=$OverallReady',
 'accessSurfaceReady=$AccessSurfaceReady',
 'runtimeProbeRequested=$RuntimeProbeRequested',
 'requestedChecksPassed=$RequestedChecksPassed',
 "readinessBasis=if($RuntimeProbeRequested){'available-access-surface-and-all-requested-checks'}else{'available-access-surface'}",
 'currentWindowsUserRawShellAuthorityExposed=',
 'arbitraryShellConfiguredLocally=$false'
)){if(-not$StatusSource.Contains($Needle)){throw "EVAVO_REMOTE_ACCESS_STATUS_CONTRACT_MISSING:$Needle"}}
foreach($Forbidden in @(
 'Invoke-Expression',
 'effectfulWorkstationToolsExposed=$true',
 'arbitraryCommandTextAccepted=$true',
 'inlineCodeAccepted=$true',
 'currentWindowsUserAuthority=$true',
 'OPENAI_API_KEY=',
 'CONTROL_PLANE_API_KEY=',
 'cloudflareCredentialValue=',
 'cloudflareAccountId='
)){if($Source.Contains($Forbidden)-or$ExecutionSource.Contains($Forbidden)){throw "EVAVO_REMOTE_ACCESS_CONTRACT_FORBIDDEN:$Forbidden"}}
foreach($Forbidden in @(
 'ok=[bool]($AutomationHealthy-or$ObserverInstalled-or$ExecutionInstalled-or$RelayTaskHealthy-or$RestHealthy)',
 'currentWindowsUserAuthority=',
 'supportedShells=',
 'acceptedRestExecutorAttestationRequired=',
 'arbitraryShellConfiguredLocally=$ExecutionInstalled'
)){if($StatusSource.Contains($Forbidden)){throw "EVAVO_REMOTE_ACCESS_STATUS_STALE_SUCCESS_OR_FIELD:$Forbidden"}}
[ordered]@{
 schemaVersion=5
 kind='evavo-remote-workstation-access-install-contract-v5'
 ok=$true
 powershellSyntaxValid=$true
 localRecoveryBootstrapRequired=$true
 observerTunnelSeparateAndReadOnly=$true
 windowsExecutionCompatibilityTunnelExplicitOptIn=$true
 windowsExecutionCompatibilityTunnelEffectful=$false
 rawShellExecutionRemoved=$true
 arbitraryCommandTextAccepted=$false
 inlineCodeAccepted=$false
 canonicalStructuredExecutor='EVAVO-STUDIO/evavo-local-compute'
 canonicalHostedEffectfulRoutes=@('cloudflare-typed-relay','github-issue-queue')
 localPublicListenerRequired=$false
 outboundSecureMcpTunnel=$true
 cloudflareCredentialAwareDeployV2Used=$true
 cloudflareProvisionExplicitOptIn=$true
 credentialValuesExposed=$false
 observerRawShellExposed=$false
 runtimeProbeAuthoritative=$true
 requestedDoctorChecksMustPass=$true
 providerProbeRequiresAtLeastOneAttempt=$true
 failedProviderProbeCannotReportOk=$true
 staleExecutionStatusFieldsForbidden=$true
 githubActionsRequired=$false
}|ConvertTo-Json -Depth 8