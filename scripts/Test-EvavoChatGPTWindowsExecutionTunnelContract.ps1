[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Installer=Join-Path $Root 'scripts\Install-EvavoChatGPTWindowsExecutionTunnel.ps1'
$Mcp=Join-Path $Root 'mcp-server\windows-chat-execution-mcp.mjs'
foreach($Path in @($Installer,$Mcp)){if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw"EVAVO_WINDOWS_EXECUTION_TUNNEL_CONTRACT_SOURCE_MISSING:$Path"}}
$Tokens=$null;$Errors=$null;[Management.Automation.Language.Parser]::ParseFile($Installer,[ref]$Tokens,[ref]$Errors)|Out-Null
if(@($Errors).Count-gt0){throw'EVAVO_WINDOWS_EXECUTION_TUNNEL_CONTRACT_PARSE_FAILED'}
$Text=Get-Content -LiteralPath $Installer -Raw -Encoding UTF8
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
    'tunnelIdValueReturned=$false'
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
    'adminKeyReturned=$true'
)){if($Text.Contains($Forbidden)){throw"EVAVO_WINDOWS_EXECUTION_TUNNEL_CONTRACT_FORBIDDEN:$Forbidden"}}
[ordered]@{
    schemaVersion=2
    kind='evavo-chatgpt-windows-execution-tunnel-static-contract-v2'
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
    chatGptProductSideConnectorSetupStillRequired=$true
    credentialsReturned=$false
    tunnelInstalled=$false
    workstationContacted=$false
}|ConvertTo-Json -Depth 8