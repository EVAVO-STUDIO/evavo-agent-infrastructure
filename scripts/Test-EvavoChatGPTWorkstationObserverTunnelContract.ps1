[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$Installer=Join-Path $PSScriptRoot 'Install-EvavoChatGPTWorkstationObserverTunnelV2.ps1'
$LegacyInstaller=Join-Path $PSScriptRoot 'Install-EvavoChatGPTWorkstationObserverTunnel.ps1'
$Status=Join-Path $PSScriptRoot 'Get-EvavoChatGPTWorkstationObserverTunnelStatus.ps1'
$Observer=Join-Path $Root 'mcp-server\workstation-observer-mcp.mjs'
foreach($Path in @($Installer,$LegacyInstaller,$Status,$Observer)){if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "Required ChatGPT workstation observer component missing: $Path"}}
foreach($PowerShellPath in @($Installer,$LegacyInstaller,$Status)){
  $tokens=$null;$errors=$null
  [Management.Automation.Language.Parser]::ParseFile($PowerShellPath,[ref]$tokens,[ref]$errors)|Out-Null
  if(@($errors).Count -gt 0){throw "ChatGPT workstation observer PowerShell parse error in $PowerShellPath: $(@($errors)[0].Message)"}
}
$installerSource=Get-Content -LiteralPath $Installer -Raw -Encoding UTF8
$statusSource=Get-Content -LiteralPath $Status -Raw -Encoding UTF8
$observerSource=Get-Content -LiteralPath $Observer -Raw -Encoding UTF8
foreach($needle in @(
 'tunnel-client','EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID','CONTROL_PLANE_API_KEY','sample_mcp_stdio_local',
 'workstation-observer-mcp.mjs','repositoryIndependentObserver=$true','developmentCheckoutRequiredAfterInstallation=$false',
 'immutableObserverBundle=$true','observerReadOnly=$true','effectfulWorkstationToolsExposed=$false',
 'chatGptProductSideConnectorSetupStillRequired=$true','proWriteActionsClaimed=$false'
)){if(-not$installerSource.Contains($needle)){throw "ChatGPT workstation observer v2 contract missing: $needle"}}
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
foreach($needle in @('schemaVersion=2','observerBundle=','repositoryIndependent=$BundleValid','developmentCheckoutRequiredAfterInstallation=$false','tunnelIdReturned=$false','runtimeKeyReturned=$false','chatGptConnectorRegistrationPerformed=$false','chatGptProductSideConnectorSetupStillRequired=$true','physicalTunnelReachabilityClaimed=')){
 if(-not$statusSource.Contains($needle)){throw "Workstation tunnel status contract missing: $needle"}
}
foreach($needle in @('Register-ScheduledTask','Start-ScheduledTask','SetEnvironmentVariable(','New-ItemProperty')){
 if($statusSource.Contains($needle)){throw "Workstation tunnel status contains mutation path: $needle"}
}
[ordered]@{
 schemaVersion=3;kind='evavo-chatgpt-workstation-observer-tunnel-contract-v3';ok=$true;powershellSyntaxValid=$true
 canonicalInstaller='Install-EvavoChatGPTWorkstationObserverTunnelV2.ps1';legacyInstallerRetained=$true
 repositoryIndependentObserver=$true;immutableObserverBundle=$true;developmentCheckoutRequiredAfterInstallation=$false
 outboundTunnelOnly=$true;observerReadOnly=$true;effectfulWorkstationToolsExposed=$false;credentialValuesExposed=$false
 readOnlyStatusSurface=$true;doctorProbeIsExplicit=$true;chatGptProductSideSetupAcknowledged=$true;proWriteActionsClaimed=$false
}|ConvertTo-Json -Depth 8
