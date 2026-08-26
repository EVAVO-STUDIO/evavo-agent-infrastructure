[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$Installer=Join-Path $PSScriptRoot 'Install-EvavoChatGPTWorkstationObserverTunnel.ps1'
$Observer=Join-Path $Root 'mcp-server\workstation-observer-mcp.mjs'
foreach($Path in @($Installer,$Observer)){if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "Required ChatGPT workstation observer component missing: $Path"}}
$tokens=$null;$errors=$null
[Management.Automation.Language.Parser]::ParseFile($Installer,[ref]$tokens,[ref]$errors)|Out-Null
if(@($errors).Count -gt 0){throw "ChatGPT workstation observer tunnel installer has PowerShell parse errors: $(@($errors)[0].Message)"}
$installerSource=Get-Content -LiteralPath $Installer -Raw -Encoding UTF8
$observerSource=Get-Content -LiteralPath $Observer -Raw -Encoding UTF8
foreach($needle in @(
 'tunnel-client','EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID','CONTROL_PLANE_API_KEY','sample_mcp_stdio_local',
 'workstation-observer-mcp.mjs','Outbound-only OpenAI Secure MCP Tunnel','observerReadOnly=$true',
 'effectfulWorkstationToolsExposed=$false','chatGptProductSideConnectorSetupStillRequired=$true','proWriteActionsClaimed=$false'
)){if(-not$installerSource.Contains($needle)){throw "ChatGPT workstation observer tunnel contract missing: $needle"}}
foreach($needle in @('manage-autonomous-node.ps1 -Action repair','INSTALL-EVAVO-ZERO-COST-WORKER-AUTOMATION.ps1 -StartNow','Invoke-Expression','powershell.command','shell.command')){
 if($installerSource.Contains($needle)){throw "ChatGPT workstation observer installer exposes effectful surface: $needle"}
}
foreach($needle in @('readOnlyHint: true','destructiveHint: false','mutationAuthority: false','credentialValuesReturned: false','physicalExecutionClaimed: false')){
 if(-not$observerSource.Contains($needle)){throw "Workstation observer read-only contract missing: $needle"}
}
foreach($needle in @('evavo_workstation_observer_status','evavo_workstation_observer_relay','evavo_workstation_observer_rest_health')){
 if(-not$observerSource.Contains($needle)){throw "Workstation observer tool missing: $needle"}
}
foreach($needle in @('Register-ScheduledTask','Start-ScheduledTask','Repair-EvavoRemoteMcpRelayClient.ps1','manage-autonomous-node.ps1","-Action","repair')){
 if($observerSource.Contains($needle)){throw "Workstation observer contains forbidden mutation path: $needle"}
}
[ordered]@{
 schemaVersion=1;kind='evavo-chatgpt-workstation-observer-tunnel-contract-v1';ok=$true;powershellSyntaxValid=$true
 outboundTunnelOnly=$true;observerReadOnly=$true;effectfulWorkstationToolsExposed=$false;credentialValuesExposed=$false
 chatGptProductSideSetupAcknowledged=$true;proWriteActionsClaimed=$false
}|ConvertTo-Json -Depth 8
