[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$Installer=Join-Path $PSScriptRoot 'Install-EvavoRemoteWorkstationAccess.ps1'
$Tunnel=Join-Path $PSScriptRoot 'Install-EvavoChatGPTWorkstationObserverTunnelV3.ps1'
$Relay=Join-Path $PSScriptRoot 'Deploy-EvavoRemoteMcpRelay.ps1'
foreach($Path in @($Installer,$Tunnel,$Relay)){if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "EVAVO_REMOTE_ACCESS_CONTRACT_MISSING:$Path"};$t=$null;$e=$null;[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$t,[ref]$e)|Out-Null;if(@($e).Count-gt0){throw "EVAVO_REMOTE_ACCESS_CONTRACT_PARSE_FAILED:$Path"}}
$Source=Get-Content -LiteralPath $Installer -Raw -Encoding UTF8
foreach($Needle in @(
 'INSTALL-EVAVO-ZERO-COST-WORKER-AUTOMATION.ps1',
 'Install-EvavoChatGPTWorkstationObserverTunnelV3.ps1',
 'Deploy-EvavoRemoteMcpRelay.ps1',
 'minimumLocalRecoveryPlanesInstalled',
 'openAiTunnelStartIsPhysicalReachabilityProof=$false',
 'cloudflareProvisionExplicitlyRequested',
 'openAiCredentialValuesReturned=$false',
 'cloudflareCredentialValuesReturned=$false',
 'arbitraryShellExposed=$false',
 'githubActionsRequired=$false',
 'physicalRemoteReachabilityClaimed=[bool]($Cloudflare-and$Cloudflare.physicalWorkstationConnectionProven)'
)){if(-not$Source.Contains($Needle)){throw "EVAVO_REMOTE_ACCESS_CONTRACT_MISSING_RULE:$Needle"}}
foreach($Forbidden in @('Invoke-Expression','powershell.command','shell.command','OPENAI_API_KEY=','CONTROL_PLANE_API_KEY=')){if($Source.Contains($Forbidden)){throw "EVAVO_REMOTE_ACCESS_CONTRACT_FORBIDDEN:$Forbidden"}}
[ordered]@{
 schemaVersion=1
 kind='evavo-remote-workstation-access-install-contract-v1'
 ok=$true
 powershellSyntaxValid=$true
 localRecoveryBootstrapRequired=$true
 secureMcpTunnelV3Used=$true
 cloudflareProvisionExplicitOptIn=$true
 tunnelTaskStartIsNotRemoteReachabilityProof=$true
 cloudflareWindowsWebSocketIsRemoteReachabilityProof=$true
 credentialValuesExposed=$false
 rawShellExposed=$false
 githubActionsRequired=$false
}|ConvertTo-Json -Depth 8
