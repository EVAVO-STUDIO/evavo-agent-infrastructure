[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$Installer=Join-Path $PSScriptRoot 'Install-EvavoRemoteWorkstationAccess.ps1'
$Tunnel=Join-Path $PSScriptRoot 'Install-EvavoChatGPTWorkstationObserverTunnelV3.ps1'
$Relay=Join-Path $PSScriptRoot 'Deploy-EvavoRemoteMcpRelayV2.ps1'
$RelayV1=Join-Path $PSScriptRoot 'Deploy-EvavoRemoteMcpRelay.ps1'
foreach($Path in @($Installer,$Tunnel,$Relay,$RelayV1)){if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "EVAVO_REMOTE_ACCESS_CONTRACT_MISSING:$Path"};$t=$null;$e=$null;[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$t,[ref]$e)|Out-Null;if(@($e).Count-gt0){throw "EVAVO_REMOTE_ACCESS_CONTRACT_PARSE_FAILED:$Path"}}
$Source=Get-Content -LiteralPath $Installer -Raw -Encoding UTF8
$RelaySource=Get-Content -LiteralPath $Relay -Raw -Encoding UTF8
foreach($Needle in @(
 'INSTALL-EVAVO-ZERO-COST-WORKER-AUTOMATION.ps1',
 'Install-EvavoChatGPTWorkstationObserverTunnelV3.ps1',
 'Deploy-EvavoRemoteMcpRelayV2.ps1',
 'minimumLocalRecoveryPlanesInstalled',
 'openAiTunnelStartIsPhysicalReachabilityProof=$false',
 'cloudflareProvisionExplicitlyRequested',
 'cloudflareExistingCredentialSourceReused=',
 'cloudflareCredentialSourceCategory=',
 'cloudflareAccountSourceCategory=',
 'openAiCredentialValuesReturned=$false',
 'cloudflareCredentialValuesReturned=$false',
 'cloudflareAccountIdReturned=$false',
 'arbitraryShellExposed=$false',
 'githubActionsRequired=$false',
 'physicalRemoteReachabilityClaimed=[bool]($Cloudflare-and$Cloudflare.physicalWorkstationConnectionProven)'
)){if(-not$Source.Contains($Needle)){throw "EVAVO_REMOTE_ACCESS_CONTRACT_MISSING_RULE:$Needle"}}
foreach($Needle in @(
 'CLOUDFLARE_API_TOKEN',
 'CF_API_TOKEN',
 'CLOUDFLARE_ACCOUNT_ID',
 'CF_ACCOUNT_ID',
 "credentialSourceCategory=`$CredentialSource",
 "accountSourceCategory=`$AccountSource",
 'cloudflareCredentialValueReturned=$false',
 'cloudflareAccountIdReturned=$false',
 'credentialPersistedByThisWrapper=$false',
 "Remove-Item Env:CLOUDFLARE_API_TOKEN",
 "Remove-Item Env:CLOUDFLARE_ACCOUNT_ID"
)){if(-not$RelaySource.Contains($Needle)){throw "EVAVO_REMOTE_ACCESS_CONTRACT_CLOUDFLARE_RULE_MISSING:$Needle"}}
foreach($Forbidden in @('Invoke-Expression','powershell.command','shell.command','OPENAI_API_KEY=','CONTROL_PLANE_API_KEY=','cloudflareCredentialValue=','cloudflareAccountId=')){if($Source.Contains($Forbidden)-or$RelaySource.Contains($Forbidden)){throw "EVAVO_REMOTE_ACCESS_CONTRACT_FORBIDDEN:$Forbidden"}}
[ordered]@{
 schemaVersion=2
 kind='evavo-remote-workstation-access-install-contract-v2'
 ok=$true
 powershellSyntaxValid=$true
 localRecoveryBootstrapRequired=$true
 secureMcpTunnelV3Used=$true
 cloudflareCredentialAwareDeployV2Used=$true
 cloudflareExistingCredentialReuseSupported=$true
 cloudflareProvisionExplicitOptIn=$true
 cloudflareCredentialValuesExposed=$false
 cloudflareAccountIdExposed=$false
 tunnelTaskStartIsNotRemoteReachabilityProof=$true
 cloudflareWindowsWebSocketIsRemoteReachabilityProof=$true
 credentialValuesExposed=$false
 rawShellExposed=$false
 githubActionsRequired=$false
}|ConvertTo-Json -Depth 8
