[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$Installer=Join-Path $PSScriptRoot 'Install-EvavoChatGPTWorkstationObserverTunnelV3.ps1'
$InstallerV2=Join-Path $PSScriptRoot 'Install-EvavoChatGPTWorkstationObserverTunnelV2.ps1'
$LegacyInstaller=Join-Path $PSScriptRoot 'Install-EvavoChatGPTWorkstationObserverTunnel.ps1'
$Status=Join-Path $PSScriptRoot 'Get-EvavoChatGPTWorkstationObserverTunnelStatus.ps1'
$Observer=Join-Path $Root 'mcp-server\workstation-observer-mcp.mjs'
foreach($Path in @($Installer,$InstallerV2,$LegacyInstaller,$Status,$Observer)){if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "Required ChatGPT workstation observer component missing: $Path"}}
foreach($PowerShellPath in @($Installer,$InstallerV2,$LegacyInstaller,$Status)){
  $tokens=$null;$errors=$null
  [Management.Automation.Language.Parser]::ParseFile($PowerShellPath,[ref]$tokens,[ref]$errors)|Out-Null
  if(@($errors).Count -gt 0){throw "ChatGPT workstation observer PowerShell parse error in $PowerShellPath: $(@($errors)[0].Message)"}
}
$installerSource=Get-Content -LiteralPath $Installer -Raw -Encoding UTF8
$v2Source=Get-Content -LiteralPath $InstallerV2 -Raw -Encoding UTF8
$legacySource=Get-Content -LiteralPath $LegacyInstaller -Raw -Encoding UTF8
$statusSource=Get-Content -LiteralPath $Status -Raw -Encoding UTF8
$observerSource=Get-Content -LiteralPath $Observer -Raw -Encoding UTF8
foreach($needle in @(
 'Install-EvavoChatGPTWorkstationObserverTunnelV2.ps1','CONTROL_PLANE_API_KEY','OPENAI_API_KEY',
 'SetEnvironmentVariable','runtimeCredentialPersistedForBackgroundTask=$true','runtimeCredentialInTaskArguments=$false',
 'runtimeCredentialValueReturned=$false','backgroundTaskAuthenticationReady=$true','repositoryIndependentObserver=$true',
 'immutableObserverBundle=$true','developmentCheckoutRequiredAfterInstallation=$false','effectfulWorkstationToolsExposed=$false',
 "scheduledTaskHost='wscript.exe'",'consoleFreeScheduledAction=$true','directTunnelClientScheduledHost=$false',
 'scheduledTaskWaitsForTunnelExit=$true','mcpCommandUsesDirectNode=$true','focusStealAllowed=$false'
)){if(-not$installerSource.Contains($needle)){throw "ChatGPT workstation observer v3 contract missing: $needle"}}
foreach($needle in @(
 'tunnel-client','sample_mcp_stdio_local','workstation-observer-mcp.mjs','repositoryIndependentObserver=$true',
 'immutableObserverBundle=$true','chatGptProductSideConnectorSetupStillRequired=$true',
 "scheduledTaskHost='wscript.exe'",'consoleFreeScheduledAction=$true','directTunnelClientScheduledHost=$false',
 'scheduledTaskWaitsForTunnelExit=$true','mcpCommandUsesDirectNode=$true','WScript.Quit exitCode',
 '$Action = New-ScheduledTaskAction -Execute $WScriptExe'
)){
 if(-not$v2Source.Contains($needle)){throw "ChatGPT workstation observer v2 compatibility contract missing: $needle"}
}
foreach($needle in @('implementationAuthority=''Install-EvavoChatGPTWorkstationObserverTunnelV2.ps1''','delegatedToV2=$true',"scheduledTaskHost='wscript.exe'",'consoleFreeScheduledAction=$true')){
 if(-not$legacySource.Contains($needle)){throw "ChatGPT workstation observer legacy compatibility contract missing: $needle"}
}
foreach($needle in @('manage-autonomous-node.ps1 -Action repair','INSTALL-EVAVO-ZERO-COST-WORKER-AUTOMATION.ps1 -StartNow','Invoke-Expression','powershell.command','shell.command')){
 if($installerSource.Contains($needle)){throw "ChatGPT workstation observer installer exposes effectful surface: $needle"}
}
foreach($needle in @('$Action = New-ScheduledTaskAction -Execute $TunnelExe')){
 if($v2Source.Contains($needle)-or$legacySource.Contains($needle)){throw "ChatGPT workstation observer task regressed to direct tunnel-client host: $needle"}
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
foreach($needle in @(
 'schemaVersion=3','evavo-chatgpt-workstation-observer-tunnel-status-v3','observerBundle=','repositoryIndependent=$BundleValid',
 'developmentCheckoutRequiredAfterInstallation=$false','tunnelIdReturned=$false','runtimeKeyReturned=$false',
 'chatGptConnectorRegistrationPerformed=$false','chatGptProductSideConnectorSetupStillRequired=$true','physicalTunnelReachabilityClaimed=',
 "host=if(`$TaskConsoleFree){'wscript.exe'}",'consoleFree=$TaskConsoleFree','directTunnelClientScheduledHost=$DirectTunnelClientScheduledHost'
)){
 if(-not$statusSource.Contains($needle)){throw "Workstation tunnel status contract missing: $needle"}
}
foreach($needle in @('Register-ScheduledTask','Start-ScheduledTask','SetEnvironmentVariable(','New-ItemProperty')){
 if($statusSource.Contains($needle)){throw "Workstation tunnel status contains mutation path: $needle"}
}
[ordered]@{
 schemaVersion=5;kind='evavo-chatgpt-workstation-observer-tunnel-contract-v5';ok=$true;powershellSyntaxValid=$true
 canonicalInstaller='Install-EvavoChatGPTWorkstationObserverTunnelV3.ps1';v2CompatibilityInstallerRetained=$true;legacyInstallerDelegatesToV2=$true
 backgroundTaskRuntimeCredentialPersisted=$true;runtimeCredentialInTaskArguments=$false;runtimeCredentialValueExposed=$false
 repositoryIndependentObserver=$true;immutableObserverBundle=$true;developmentCheckoutRequiredAfterInstallation=$false
 scheduledTaskHost='wscript.exe';consoleFreeScheduledAction=$true;directTunnelClientScheduledHost=$false;scheduledTaskWaitsForTunnelExit=$true;mcpCommandUsesDirectNode=$true
 outboundTunnelOnly=$true;observerReadOnly=$true;effectfulWorkstationToolsExposed=$false;credentialValuesExposed=$false
 readOnlyStatusSurface=$true;doctorProbeIsExplicit=$true;chatGptProductSideSetupAcknowledged=$true;proWriteActionsClaimed=$false
}|ConvertTo-Json -Depth 8
