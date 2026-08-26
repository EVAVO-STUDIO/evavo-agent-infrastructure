[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$Installer=Join-Path $PSScriptRoot 'Install-EvavoRemoteWorkstationAccess.ps1'
$ObserverTunnel=Join-Path $PSScriptRoot 'Install-EvavoChatGPTWorkstationObserverTunnelV3.ps1'
$ExecutionTunnel=Join-Path $PSScriptRoot 'Install-EvavoChatGPTWindowsExecutionTunnel.ps1'
$Relay=Join-Path $PSScriptRoot 'Deploy-EvavoRemoteMcpRelayV2.ps1'
$RelayV1=Join-Path $PSScriptRoot 'Deploy-EvavoRemoteMcpRelay.ps1'
foreach($Path in @($Installer,$ObserverTunnel,$ExecutionTunnel,$Relay,$RelayV1)){if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "EVAVO_REMOTE_ACCESS_CONTRACT_MISSING:$Path"};$t=$null;$e=$null;[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$t,[ref]$e)|Out-Null;if(@($e).Count-gt0){throw "EVAVO_REMOTE_ACCESS_CONTRACT_PARSE_FAILED:$Path"}}
$Source=Get-Content -LiteralPath $Installer -Raw -Encoding UTF8
$ObserverSource=Get-Content -LiteralPath $ObserverTunnel -Raw -Encoding UTF8
$ExecutionSource=Get-Content -LiteralPath $ExecutionTunnel -Raw -Encoding UTF8
$RelaySource=Get-Content -LiteralPath $Relay -Raw -Encoding UTF8
foreach($Needle in @(
 'INSTALL-EVAVO-ZERO-COST-WORKER-AUTOMATION.ps1',
 'Install-EvavoChatGPTWorkstationObserverTunnelV3.ps1',
 'Install-EvavoChatGPTWindowsExecutionTunnel.ps1',
 'Deploy-EvavoRemoteMcpRelayV2.ps1',
 'EnableWindowsExecution',
 'windowsExecutionExplicitlyRequested',
 'windowsExecutionEstablished',
 'effectfulWorkstationToolsExposed=',
 'arbitraryCommandTextAccepted=',
 'currentWindowsUserAuthority=',
 'supportedExecutionShells=',
 'acceptedRestExecutorAttestationRequired=',
 'observerArbitraryShellExposed=$false',
 'executionShellSeparatedFromObserver=$true',
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
 'effectfulWorkstationToolsExposed=$true',
 'arbitraryCommandTextAccepted=$true',
 'inlineCodeAccepted=$true',
 'currentWindowsUserAuthority=$true',
 "supportedShells=@('powershell','cmd','bash','python')",
 'acceptedRestExecutorAttestationRequired=$true',
 'localPublicListenerRequired=$false',
 'outboundOnly=$true'
)){if(-not$ExecutionSource.Contains($Needle)){throw "EVAVO_REMOTE_ACCESS_CONTRACT_EXECUTION_RULE_MISSING:$Needle"}}
foreach($Needle in @(
 'CLOUDFLARE_API_TOKEN','CF_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','CF_ACCOUNT_ID',
 'cloudflareCredentialValueReturned=$false','cloudflareAccountIdReturned=$false','credentialPersistedByThisWrapper=$false'
)){if(-not$RelaySource.Contains($Needle)){throw "EVAVO_REMOTE_ACCESS_CONTRACT_CLOUDFLARE_RULE_MISSING:$Needle"}}
foreach($Forbidden in @('Invoke-Expression','OPENAI_API_KEY=','CONTROL_PLANE_API_KEY=','cloudflareCredentialValue=','cloudflareAccountId=')){if($Source.Contains($Forbidden)-or$ObserverSource.Contains($Forbidden)-or$ExecutionSource.Contains($Forbidden)-or$RelaySource.Contains($Forbidden)){throw "EVAVO_REMOTE_ACCESS_CONTRACT_FORBIDDEN:$Forbidden"}}
[ordered]@{
 schemaVersion=3
 kind='evavo-remote-workstation-access-install-contract-v3'
 ok=$true
 powershellSyntaxValid=$true
 localRecoveryBootstrapRequired=$true
 observerTunnelSeparateAndReadOnly=$true
 windowsExecutionTunnelExplicitOptIn=$true
 windowsExecutionTunnelEffectful=$true
 arbitraryCommandTextAcceptedWhenExplicitlyEnabled=$true
 currentWindowsUserAuthority=$true
 supportedExecutionShells=@('powershell','cmd','bash','python')
 acceptedRestExecutorAttestationRequired=$true
 localPublicListenerRequired=$false
 outboundSecureMcpTunnel=$true
 cloudflareCredentialAwareDeployV2Used=$true
 cloudflareProvisionExplicitOptIn=$true
 credentialValuesExposed=$false
 observerRawShellExposed=$false
 githubActionsRequired=$false
}|ConvertTo-Json -Depth 8
