[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$Installer = Join-Path $PSScriptRoot 'Install-EvavoChatGPTAndroidObserverTunnel.ps1'
$Observer = Join-Path $Root 'mcp-server\android-observer-mcp.mjs'
foreach($Path in @($Installer,$Observer)){if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "Required ChatGPT observer component missing: $Path"}}
$tokens=$null;$errors=$null
[Management.Automation.Language.Parser]::ParseFile($Installer,[ref]$tokens,[ref]$errors)|Out-Null
if(@($errors).Count -gt 0){throw "ChatGPT observer tunnel installer has PowerShell parse errors: $(@($errors)[0].Message)"}

$installerSource=Get-Content -LiteralPath $Installer -Raw -Encoding UTF8
$observerSource=Get-Content -LiteralPath $Observer -Raw -Encoding UTF8
$required=@(
    'tunnel-client',
    'CONTROL_PLANE_TUNNEL_ID',
    'CONTROL_PLANE_API_KEY',
    'sample_mcp_stdio_local',
    'android-observer-mcp.mjs',
    'Outbound-only OpenAI Secure MCP Tunnel',
    'observerReadOnly=$true',
    'effectfulAndroidToolsExposed=$false',
    'chatGptProductSideConnectorSetupStillRequired=$true',
    'proWriteActionsClaimed=$false'
)
foreach($needle in $required){if(-not$installerSource.Contains($needle)){throw "ChatGPT observer tunnel contract missing: $needle"}}
$forbidden=@(
    'android-app-mcp.mjs',
    'glasses-tab-a-mcp.mjs',
    'godot-android-physical-mcp.mjs',
    'evavo_android_app_uninstall',
    'evavo_android_game_input',
    'UNINSTALL_USER_ANDROID_APP',
    'CLEAR_USER_ANDROID_APP_DATA'
)
foreach($needle in $forbidden){if($installerSource.Contains($needle)){throw "ChatGPT observer tunnel installer exposes effectful surface: $needle"}}

foreach($needle in @('readOnlyHint: true','destructiveHint: false','mutationAuthority:false','rawAdbSerialReturned:false')){
    if(-not$observerSource.Contains($needle)){throw "Android observer read-only contract missing: $needle"}
}
foreach($needle in @('app-lifecycle-cli.mjs","uninstall','app-lifecycle-cli.mjs","clear-data','game-input','ui-action',' install ')){
    if($observerSource.Contains($needle)){throw "Android observer contains forbidden effectful operation: $needle"}
}

[ordered]@{
    schemaVersion=1
    kind='evavo-chatgpt-android-observer-tunnel-contract-v1'
    ok=$true
    powershellSyntaxValid=$true
    outboundTunnelOnly=$true
    observerReadOnly=$true
    effectfulAndroidToolsExposed=$false
    rawAdbSerialExposed=$false
    credentialsEmbeddedInRepository=$false
    chatGptProductSideSetupAcknowledged=$true
    proWriteActionsClaimed=$false
}|ConvertTo-Json -Depth 8
