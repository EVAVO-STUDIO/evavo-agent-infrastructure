[CmdletBinding()]
param(
    [string]$Profile = 'evavo-workstation-observer',
    [string]$TunnelName = 'EVAVO Workstation Observer',
    [string]$TunnelId = '',
    [string]$WorkspaceId = '',
    [string]$OrganizationId = '',
    [switch]$CreateTunnelIfMissing,
    [switch]$StartNow,
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:OS -ne 'Windows_NT') { throw 'EVAVO_WORKSTATION_OBSERVER_COMPAT_WINDOWS_REQUIRED' }

$V2 = Join-Path $PSScriptRoot 'Install-EvavoChatGPTWorkstationObserverTunnelV2.ps1'
if (-not (Test-Path -LiteralPath $V2 -PathType Leaf)) { throw 'EVAVO_WORKSTATION_OBSERVER_COMPAT_V2_MISSING' }
$Item = Get-Item -LiteralPath $V2 -Force -ErrorAction Stop
if ($Item.PSIsContainer -or (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'EVAVO_WORKSTATION_OBSERVER_COMPAT_V2_UNSAFE' }
$Tokens=$null;$Errors=$null
[Management.Automation.Language.Parser]::ParseFile($V2,[ref]$Tokens,[ref]$Errors) | Out-Null
if (@($Errors).Count -gt 0) { throw 'EVAVO_WORKSTATION_OBSERVER_COMPAT_V2_PARSE_FAILED' }

$Parameters = @{
    Profile = $Profile
    TunnelName = $TunnelName
    CreateTunnelIfMissing = [bool]$CreateTunnelIfMissing
    StartNow = [bool]$StartNow
    Json = $true
}
if (-not [string]::IsNullOrWhiteSpace($TunnelId)) { $Parameters.TunnelId = $TunnelId }
if (-not [string]::IsNullOrWhiteSpace($WorkspaceId)) { $Parameters.WorkspaceId = $WorkspaceId }
if (-not [string]::IsNullOrWhiteSpace($OrganizationId)) { $Parameters.OrganizationId = $OrganizationId }

$Raw = (& $V2 @Parameters 2>&1 | Out-String).Trim()
if (-not $Raw) { throw 'EVAVO_WORKSTATION_OBSERVER_COMPAT_V2_RECEIPT_MISSING' }
try { $V2Receipt = $Raw | ConvertFrom-Json -ErrorAction Stop }
catch { throw 'EVAVO_WORKSTATION_OBSERVER_COMPAT_V2_RECEIPT_INVALID' }
if (
    [int]$V2Receipt.schemaVersion -ne 2 -or
    [string]$V2Receipt.kind -ne 'evavo-chatgpt-workstation-observer-tunnel-installation-v2' -or
    $V2Receipt.ok -ne $true -or
    $V2Receipt.scheduledTaskExact -ne $true -or
    [string]$V2Receipt.scheduledTaskHost -ne 'wscript.exe' -or
    $V2Receipt.consoleFreeScheduledAction -ne $true -or
    $V2Receipt.directTunnelClientScheduledHost -ne $false -or
    $V2Receipt.scheduledTaskWaitsForTunnelExit -ne $true -or
    $V2Receipt.mcpCommandUsesDirectNode -ne $true -or
    $V2Receipt.observerReadOnly -ne $true -or
    $V2Receipt.observerMutationAuthority -ne $false
) { throw 'EVAVO_WORKSTATION_OBSERVER_COMPAT_V2_NOT_PROVEN' }

$Receipt = [ordered]@{
    schemaVersion=1
    kind='evavo-chatgpt-workstation-observer-tunnel-installation-v1'
    ok=$true
    compatibilityEntrypoint=$true
    implementationAuthority='Install-EvavoChatGPTWorkstationObserverTunnelV2.ps1'
    delegatedToV2=$true
    tunnelCreated=[bool]$V2Receipt.tunnelCreated
    tunnelIdReturned=$false
    profile=[string]$V2Receipt.profile
    scheduledTaskExact=$true
    scheduledTaskHost='wscript.exe'
    consoleFreeScheduledAction=$true
    directTunnelClientScheduledHost=$false
    scheduledTaskWaitsForTunnelExit=$true
    mcpCommandUsesDirectNode=$true
    limitedInteractiveUser=$true
    startAtLogon=$true
    periodicRecoveryMinutes=15
    started=[bool]$V2Receipt.started
    outboundOnly=$true
    localMcpPublicListenerRequired=$false
    observerReadOnly=$true
    observerMutationAuthority=$false
    effectfulWorkstationToolsExposed=$false
    rawShellExposed=$false
    credentialValuesReturned=$false
    runtimeApiKeyReturned=$false
    adminKeyReturned=$false
    chatGptConnectorRegistrationPerformed=$false
    chatGptProductSideConnectorSetupStillRequired=$true
    proWriteActionsClaimed=$false
    v2=$V2Receipt
}
if ($Json) { $Receipt | ConvertTo-Json -Depth 12 -Compress } else { $Receipt | ConvertTo-Json -Depth 12 }
