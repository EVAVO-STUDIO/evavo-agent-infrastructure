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
if ($env:OS -ne 'Windows_NT') { throw 'EVAVO_WORKSTATION_OBSERVER_V3_WINDOWS_REQUIRED' }

$InstallerV2 = Join-Path $PSScriptRoot 'Install-EvavoChatGPTWorkstationObserverTunnelV2.ps1'
if (-not (Test-Path -LiteralPath $InstallerV2 -PathType Leaf)) { throw 'EVAVO_WORKSTATION_OBSERVER_V3_V2_INSTALLER_MISSING' }
$Tokens=$null; $Errors=$null
[Management.Automation.Language.Parser]::ParseFile($InstallerV2,[ref]$Tokens,[ref]$Errors) | Out-Null
if (@($Errors).Count -gt 0) { throw 'EVAVO_WORKSTATION_OBSERVER_V3_V2_INSTALLER_PARSE_FAILED' }

$RuntimeKey = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','User')
$RuntimeKeySource = 'user-control-plane'
if ([string]::IsNullOrWhiteSpace($RuntimeKey)) { $RuntimeKey = [string]$env:CONTROL_PLANE_API_KEY; $RuntimeKeySource='process-control-plane' }
if ([string]::IsNullOrWhiteSpace($RuntimeKey)) { $RuntimeKey = [Environment]::GetEnvironmentVariable('OPENAI_API_KEY','User'); $RuntimeKeySource='user-openai' }
if ([string]::IsNullOrWhiteSpace($RuntimeKey)) { $RuntimeKey = [string]$env:OPENAI_API_KEY; $RuntimeKeySource='process-openai' }
if ([string]::IsNullOrWhiteSpace($RuntimeKey)) { throw 'EVAVO_WORKSTATION_OBSERVER_V3_RUNTIME_KEY_REQUIRED' }

$ExistingUserControl = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','User')
$PersistedRuntimeKeyForBackgroundTask = $false
if ([string]::IsNullOrWhiteSpace($ExistingUserControl)) {
    [Environment]::SetEnvironmentVariable('CONTROL_PLANE_API_KEY',$RuntimeKey,'User')
    [Environment]::SetEnvironmentVariable('CONTROL_PLANE_API_KEY',$RuntimeKey,'Process')
    $PersistedRuntimeKeyForBackgroundTask = $true
}
$EffectiveUserControl = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','User')
if ([string]::IsNullOrWhiteSpace($EffectiveUserControl)) { throw 'EVAVO_WORKSTATION_OBSERVER_V3_USER_RUNTIME_KEY_PERSIST_FAILED' }

$Arguments = @{
    Profile=$Profile
    TunnelName=$TunnelName
    TunnelId=$TunnelId
    WorkspaceId=$WorkspaceId
    OrganizationId=$OrganizationId
    CreateTunnelIfMissing=$CreateTunnelIfMissing
    StartNow=$StartNow
    Json=$true
}
try {
    $Raw = (& $InstallerV2 @Arguments | Out-String).Trim()
    if (-not $Raw) { throw 'EVAVO_WORKSTATION_OBSERVER_V3_V2_RECEIPT_MISSING' }
    $ReceiptV2 = $Raw | ConvertFrom-Json -ErrorAction Stop
    if (
        [int]$ReceiptV2.schemaVersion -lt 2 -or
        [string]$ReceiptV2.kind -ne 'evavo-chatgpt-workstation-observer-tunnel-installation-v2' -or
        $ReceiptV2.ok -ne $true -or
        $ReceiptV2.scheduledTaskExact -ne $true -or
        $ReceiptV2.repositoryIndependentObserver -ne $true -or
        $ReceiptV2.immutableObserverBundle -ne $true -or
        $ReceiptV2.developmentCheckoutRequiredAfterInstallation -ne $false -or
        $ReceiptV2.observerReadOnly -ne $true -or
        $ReceiptV2.effectfulWorkstationToolsExposed -ne $false -or
        $ReceiptV2.credentialValuesReturned -ne $false
    ) { throw 'EVAVO_WORKSTATION_OBSERVER_V3_V2_RECEIPT_INVALID' }

    [ordered]@{
        schemaVersion=3
        kind='evavo-chatgpt-workstation-observer-tunnel-installation-v3'
        ok=$true
        profile=$Profile
        canonicalInstaller='v3-wrapper-over-v2'
        runtimeCredentialPersistedForBackgroundTask=$true
        runtimeCredentialPersistedThisRun=$PersistedRuntimeKeyForBackgroundTask
        runtimeCredentialSourceCategory=$RuntimeKeySource
        runtimeCredentialValueReturned=$false
        runtimeCredentialInTaskArguments=$false
        runtimeCredentialInObserverBundle=$false
        repositoryIndependentObserver=$true
        immutableObserverBundle=$true
        scheduledTaskExact=$true
        backgroundTaskAuthenticationReady=$true
        tunnelCreated=[bool]$ReceiptV2.tunnelCreated
        tunnelIdReturned=$false
        started=[bool]$ReceiptV2.started
        outboundOnly=$true
        observerReadOnly=$true
        effectfulWorkstationToolsExposed=$false
        developmentCheckoutRequiredAfterInstallation=$false
        chatGptConnectorRegistrationPerformed=$false
        chatGptProductSideConnectorSetupStillRequired=$true
        v2=$ReceiptV2
    } | ConvertTo-Json -Depth 12
}
finally {
    $RuntimeKey = $null
    $EffectiveUserControl = $null
    $ExistingUserControl = $null
}
