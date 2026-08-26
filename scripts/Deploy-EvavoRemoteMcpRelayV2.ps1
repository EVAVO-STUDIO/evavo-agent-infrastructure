[CmdletBinding()]
param(
    [string]$RelayBaseUrl = '',
    [string]$LocalStorageRoot = '',
    [switch]$SkipPackageInstall,
    [switch]$SkipWorkstationClientInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($env:OS-ne'Windows_NT'){throw'EVAVO_REMOTE_MCP_RELAY_DEPLOY_V2_WINDOWS_REQUIRED'}

$V1=Join-Path $PSScriptRoot 'Deploy-EvavoRemoteMcpRelay.ps1'
if(-not(Test-Path -LiteralPath $V1 -PathType Leaf)){throw'EVAVO_REMOTE_MCP_RELAY_DEPLOY_V2_V1_MISSING'}
$t=$null;$e=$null
[Management.Automation.Language.Parser]::ParseFile($V1,[ref]$t,[ref]$e)|Out-Null
if(@($e).Count-gt0){throw'EVAVO_REMOTE_MCP_RELAY_DEPLOY_V2_V1_PARSE_FAILED'}

$CredentialSource='wrangler-session-or-provider-default'
$AccountSource='wrangler-session-or-config'
$MappedToken=$false
$MappedAccount=$false

if(-not[string]::IsNullOrWhiteSpace([string]$env:CLOUDFLARE_API_TOKEN)){
    $CredentialSource='CLOUDFLARE_API_TOKEN'
}elseif(-not[string]::IsNullOrWhiteSpace([string]$env:CF_API_TOKEN)){
    $env:CLOUDFLARE_API_TOKEN=[string]$env:CF_API_TOKEN
    $CredentialSource='CF_API_TOKEN'
    $MappedToken=$true
}

if(-not[string]::IsNullOrWhiteSpace([string]$env:CLOUDFLARE_ACCOUNT_ID)){
    $AccountSource='CLOUDFLARE_ACCOUNT_ID'
}elseif(-not[string]::IsNullOrWhiteSpace([string]$env:CF_ACCOUNT_ID)){
    $env:CLOUDFLARE_ACCOUNT_ID=[string]$env:CF_ACCOUNT_ID
    $AccountSource='CF_ACCOUNT_ID'
    $MappedAccount=$true
}

$Args=@{}
if($RelayBaseUrl){$Args.RelayBaseUrl=$RelayBaseUrl}
if($LocalStorageRoot){$Args.LocalStorageRoot=$LocalStorageRoot}
if($SkipPackageInstall){$Args.SkipPackageInstall=$true}
if($SkipWorkstationClientInstall){$Args.SkipWorkstationClientInstall=$true}

try{
    $Raw=(& $V1 @Args | Out-String).Trim()
    if(-not$Raw){throw'EVAVO_REMOTE_MCP_RELAY_DEPLOY_V2_RECEIPT_MISSING'}
    $V1Receipt=$Raw|ConvertFrom-Json -ErrorAction Stop
    if([int]$V1Receipt.schemaVersion-lt2-or[string]$V1Receipt.kind-ne'evavo-remote-mcp-relay-deployment'-or$V1Receipt.ok-ne$true-or$V1Receipt.workstationSecretReturned-ne$false-or$V1Receipt.dispatchSecretReturned-ne$false){throw'EVAVO_REMOTE_MCP_RELAY_DEPLOY_V2_RECEIPT_INVALID'}
    [ordered]@{
        schemaVersion=3
        kind='evavo-remote-mcp-relay-deployment-v2'
        ok=$true
        credentialSourceCategory=$CredentialSource
        accountSourceCategory=$AccountSource
        existingProviderCredentialReused=$true
        compatibilityEnvAliasMapped=[bool]($MappedToken-or$MappedAccount)
        cloudflareCredentialValueReturned=$false
        cloudflareAccountIdReturned=$false
        credentialPersistedByThisWrapper=$false
        relay=$V1Receipt
        relayBaseUrl=[string]$V1Receipt.relayBaseUrl
        mcpUrl=[string]$V1Receipt.mcpUrl
        healthUrl=[string]$V1Receipt.healthUrl
        workstationClientInstalled=[bool]$V1Receipt.workstationClientInstalled
        physicalWorkstationConnectionProven=[bool]$V1Receipt.physicalWorkstationConnectionProven
        workstationSecretReturned=$false
        dispatchSecretReturned=$false
        dispatchCallerCredentialProvisioned=[bool]$V1Receipt.dispatchCallerCredentialProvisioned
        effectfulDispatchReadyForExternalCaller=[bool]$V1Receipt.effectfulDispatchReadyForExternalCaller
        githubActionsRequired=$false
        vercelRequired=$false
        paidRelayRequired=$false
    }|ConvertTo-Json -Depth 14
}finally{
    if($MappedToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
    if($MappedAccount){Remove-Item Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue}
}
