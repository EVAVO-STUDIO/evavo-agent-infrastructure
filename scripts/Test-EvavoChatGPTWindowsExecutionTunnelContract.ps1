[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Installer=Join-Path $Root 'scripts\Install-EvavoChatGPTWindowsExecutionTunnel.ps1'
$Status=Join-Path $Root 'scripts\Get-EvavoChatGPTWindowsExecutionTunnelStatus.ps1'
$Mcp=Join-Path $Root 'mcp-server\windows-chat-execution-mcp.mjs'
foreach($Path in @($Installer,$Status,$Mcp)){if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw"EVAVO_WINDOWS_EXECUTION_TUNNEL_CONTRACT_SOURCE_MISSING:$Path"}}
foreach($PowerShellSource in @($Installer,$Status)){
    $Tokens=$null;$Errors=$null
    [Management.Automation.Language.Parser]::ParseFile($PowerShellSource,[ref]$Tokens,[ref]$Errors)|Out-Null
    if(@($Errors).Count-gt0){throw"EVAVO_WINDOWS_EXECUTION_TUNNEL_CONTRACT_PARSE_FAILED:$PowerShellSource"}
}
$Text=Get-Content -LiteralPath $Installer -Raw -Encoding UTF8
$StatusText=Get-Content -LiteralPath $Status -Raw -Encoding UTF8
foreach($Required in @(
    'evavo-windows-execution',
    'EVAVO Windows Execution Compatibility',
    'windows-chat-execution-mcp.mjs',
    'EVAVO ChatGPT Windows Execution Compatibility Tunnel',
    'sample_mcp_stdio_local',
    'effectfulWorkstationToolsExposed=$false',
    'rawShellExecutionRemoved=$true',
    'arbitraryCommandTextAccepted=$false',
    'inlineCodeAccepted=$false',
    'currentWindowsUserRawShellAuthorityExposed=$false',
    "canonicalStructuredExecutor='EVAVO-STUDIO/evavo-local-compute'",
    "canonicalWorkstationBridge='evavo-windows-workstation-bridge'",
    "effectfulCloudFallbacks=@('cloudflare-typed-relay','github-issue-queue')",
    'localPublicListenerRequired=$false',
    'outboundOnly=$true',
    'chatGptProductSideConnectorSetupStillRequired=$true',
    'runtimeCredentialValueReturned=$false',
    'tunnelIdValueReturned=$false',
    "scheduledTaskHost='wscript.exe'",
    'consoleFreeScheduledAction=$true',
    'directTunnelClientScheduledHost=$false',
    'scheduledTaskWaitsForTunnelExit=$true',
    'mcpCommandUsesDirectNode=$true',
    'legacyPowerShellMcpLauncherAuthoritative=$false',
    'WScript.Quit exitCode',
    '$Action=New-ScheduledTaskAction -Execute $WScriptExe'
)){if(-not$Text.Contains($Required)){throw"EVAVO_WINDOWS_EXECUTION_TUNNEL_CONTRACT_MISSING:$Required"}}
foreach($Forbidden in @(
    'effectfulWorkstationToolsExposed=$true',
    'arbitraryCommandTextAccepted=$true',
    'inlineCodeAccepted=$true',
    'currentWindowsUserAuthority=$true',
    "supportedShells=@('powershell','cmd','bash','python')",
    'acceptedRestExecutorAttestationRequired=$true',
    'localPublicListenerRequired=$true',
    'runtimeCredentialValueReturned=$true',
    'adminKeyReturned=$true',
    '$Action=New-ScheduledTaskAction -Execute $TunnelExe'
)){if($Text.Contains($Forbidden)){throw"EVAVO_WINDOWS_EXECUTION_TUNNEL_CONTRACT_FORBIDDEN:$Forbidden"}}

foreach($Required in @(
    '$InstalledReady=[bool]($Tunnel-and$TunnelIdConfigured-and$BundleIntegrity-and$TaskExact)',
    '$RuntimeReady=[bool]($InstalledReady-and(-not$ProbeTunnelDoctor-or$DoctorPassed))',
    'ok=$RuntimeReady',
    'runtimeReadinessProbed=[bool]$ProbeTunnelDoctor',
    'runtimeReady=$RuntimeReady',
    "readinessBasis=if($ProbeTunnelDoctor){'installed-state-and-tunnel-doctor'}else{'installed-state-only'}"
)){if(-not$StatusText.Contains($Required)){throw"EVAVO_WINDOWS_EXECUTION_TUNNEL_STATUS_CONTRACT_MISSING:$Required"}}
foreach($Forbidden in @(
    'ok=[bool]($Tunnel-and$TunnelIdConfigured-and$BundleIntegrity-and$TaskExact)'
)){if($StatusText.Contains($Forbidden)){throw"EVAVO_WINDOWS_EXECUTION_TUNNEL_STATUS_CONTRACT_STALE_SUCCESS:$Forbidden"}}

[ordered]@{
    schemaVersion=4
    kind='evavo-chatgpt-windows-execution-tunnel-static-contract-v4'
    ok=$true
    separateFromObserverTunnel=$true
    compatibilityShim=$true
    outboundOnly=$true
    effectfulWorkstationToolsExposed=$false
    rawShellExecutionRemoved=$true
    arbitraryCommandTextAccepted=$false
    inlineCodeAccepted=$false
    currentWindowsUserRawShellAuthorityExposed=$false
    canonicalStructuredExecutor='EVAVO-STUDIO/evavo-local-compute'
    canonicalWorkstationBridge='evavo-windows-workstation-bridge'
    localPublicListenerRequired=$false
    immutableBundle=$true
    scheduledTaskPersistence=$true
    scheduledTaskHost='wscript.exe'
    consoleFreeScheduledAction=$true
    directTunnelClientScheduledHost=$false
    scheduledTaskWaitsForTunnelExit=$true
    mcpCommandUsesDirectNode=$true
    legacyPowerShellMcpLauncherAuthoritative=$false
    runtimeProbeAuthoritative=$true
    failedDoctorCannotReportOk=$true
    chatGptProductSideConnectorSetupStillRequired=$true
    credentialsReturned=$false
    tunnelInstalled=$false
    workstationContacted=$false
}|ConvertTo-Json -Depth 8