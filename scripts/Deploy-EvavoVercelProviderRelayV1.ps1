[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$Json
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-EnvFileValue {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Name
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
    $Item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($Item.PSIsContainer -or ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return '' }
    foreach ($Raw in Get-Content -LiteralPath $Path -Encoding UTF8) {
        $Line = [string]$Raw
        if ($Line -notmatch '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') { continue }
        if ([string]$Matches[1] -cne $Name) { continue }
        $Value = [string]$Matches[2]
        if (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or ($Value.StartsWith("'") -and $Value.EndsWith("'"))) {
            if ($Value.Length -ge 2) { $Value = $Value.Substring(1,$Value.Length-2) }
        }
        return $Value.Trim()
    }
    return ''
}

$Root = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($RepositoryRoot)).TrimEnd('\')
$Package = Join-Path $Root 'packages\vercel-provider-relay'
$Config = Join-Path $Package 'wrangler.jsonc'
$BaseWorker = Join-Path $Package 'src\worker.ts'
$DesiredWorker = Join-Path $Package 'src\desired-state-worker.ts'
$DesiredState = Join-Path $Root 'config\vercel-provider-desired-state-v1.json'
foreach ($Path in @($Package,$Config,$BaseWorker,$DesiredWorker,$DesiredState)) {
    if (-not (Test-Path -LiteralPath $Path)) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_SOURCE_MISSING' }
    $Item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_SOURCE_UNSAFE' }
}

$CfToken = [string]$(if ($env:CLOUDFLARE_API_TOKEN) { $env:CLOUDFLARE_API_TOKEN } else { $env:CF_API_TOKEN })
$VercelToken = [string]$(if ($env:VERCEL_TOKEN) { $env:VERCEL_TOKEN } else { $env:VERCEL_API_TOKEN })
$GithubReadToken = [string]$(if ($env:EVAVO_GITHUB_READ_TOKEN) { $env:EVAVO_GITHUB_READ_TOKEN } else { $env:GITHUB_TOKEN })
if ([string]::IsNullOrWhiteSpace($GithubReadToken)) {
    $GitRoot = Split-Path -Parent $Root
    $GithubEnv = Join-Path $GitRoot 'evavo-github-mcp\.env'
    $GithubReadToken = Get-EnvFileValue -Path $GithubEnv -Name 'GITHUB_TOKEN'
}
if ([string]::IsNullOrWhiteSpace($CfToken)) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_CLOUDFLARE_TOKEN_REQUIRED' }
if ([string]::IsNullOrWhiteSpace($VercelToken)) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_VERCEL_TOKEN_REQUIRED' }
if ([string]::IsNullOrWhiteSpace($GithubReadToken)) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_GITHUB_READ_TOKEN_REQUIRED' }

$Npm = (Get-Command npm.cmd,npm -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$Wrangler = Join-Path $Package 'node_modules\.bin\wrangler.cmd'
if (-not (Test-Path -LiteralPath $Wrangler -PathType Leaf)) {
    & $Npm install --no-audit --no-fund --ignore-scripts --prefix $Package | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Wrangler -PathType Leaf)) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_DEPENDENCIES_FAILED' }
}

# Compile the exact Worker source before any provider secret or deployment mutation.
$DryRun = (& $Wrangler deploy --dry-run --config $Config 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_DRY_RUN_FAILED' }

$StateRoot = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'EVAVO\VercelProviderRelay' } else { Join-Path $env:TEMP 'EVAVO\VercelProviderRelay' }
New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
$TokenPath = Join-Path $StateRoot 'control-token.txt'
if (Test-Path -LiteralPath $TokenPath -PathType Leaf) {
    $TokenItem = Get-Item -LiteralPath $TokenPath -Force -ErrorAction Stop
    if ($TokenItem.PSIsContainer -or ($TokenItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_CONTROL_TOKEN_PATH_UNSAFE' }
    $ControlToken = (Get-Content -LiteralPath $TokenPath -Raw -Encoding UTF8).Trim()
} else {
    $Bytes = New-Object byte[] 32
    $Rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $Rng.GetBytes($Bytes) } finally { $Rng.Dispose() }
    $ControlToken = [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
    [IO.File]::WriteAllText($TokenPath,$ControlToken,[Text.UTF8Encoding]::new($false))
}
if ($ControlToken.Length -lt 32) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_CONTROL_TOKEN_INVALID' }

$PreviousCf = $env:CLOUDFLARE_API_TOKEN
try {
    $env:CLOUDFLARE_API_TOKEN = $CfToken
    $VercelToken | & $Wrangler secret put VERCEL_TOKEN --config $Config | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_VERCEL_SECRET_FAILED' }
    $ControlToken | & $Wrangler secret put CONTROL_TOKEN --config $Config | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_CONTROL_SECRET_FAILED' }
    $GithubReadToken | & $Wrangler secret put GITHUB_TOKEN --config $Config | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_GITHUB_SECRET_FAILED' }
    $Deploy = (& $Wrangler deploy --config $Config 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_DEPLOY_FAILED' }
} finally {
    $env:CLOUDFLARE_API_TOKEN = $PreviousCf
}

$UrlMatch = [regex]::Matches($Deploy,'https://[A-Za-z0-9.-]+\.workers\.dev') | Select-Object -Last 1
if ($null -eq $UrlMatch) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_URL_NOT_OBSERVED' }
$BaseUrl = [string]$UrlMatch.Value
$Health = Invoke-RestMethod -Uri ($BaseUrl + '/health') -Method Get -TimeoutSec 30
if (
    $Health.ok -ne $true -or
    $Health.workstationRequired -ne $false -or
    $Health.providerCredentialConfigured -ne $true -or
    $Health.controlCredentialConfigured -ne $true -or
    $Health.desiredStateReconcilerConfigured -ne $true -or
    [string]$Health.desiredStateRepository -ne 'EVAVO-STUDIO/evavo-agent-infrastructure' -or
    [string]$Health.desiredStatePath -ne 'config/vercel-provider-desired-state-v1.json'
) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_HEALTH_NOT_PROVEN' }

$Headers = @{ Authorization = "Bearer $ControlToken" }
$ProbeBody = @{ request = @{ operation = 'project.list'; query = @{ limit = 1 } }; execute = $false } | ConvertTo-Json -Depth 8 -Compress
$Probe = Invoke-RestMethod -Uri ($BaseUrl + '/api/control') -Method Post -Headers $Headers -ContentType 'application/json' -Body $ProbeBody -TimeoutSec 45
if ($Probe.ok -ne $true -or $Probe.status -ne 'completed' -or $Probe.executed -ne $true -or $Probe.operation -ne 'project.list') {
    throw 'EVAVO_VERCEL_PROVIDER_RELAY_PROVIDER_PROBE_FAILED'
}

# Force one immediate desired-state convergence. Cron provides the durable retry lane.
$Reconcile = Invoke-RestMethod -Uri ($BaseUrl + '/api/reconcile') -Method Post -Headers $Headers -ContentType 'application/json' -Body '{}' -TimeoutSec 120
if (
    $Reconcile.ok -ne $true -or
    [string]$Reconcile.kind -ne 'evavo-vercel-provider-desired-state-reconcile-v1' -or
    $Reconcile.enabled -ne $true -or
    $Reconcile.workstationRequired -ne $false -or
    $Reconcile.githubMutationPerformed -ne $false -or
    $Reconcile.destructiveProviderOperationPerformed -ne $false
) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_RECONCILE_NOT_PROVEN' }

$Result = [ordered]@{
    schemaVersion = 2
    kind = 'evavo-vercel-provider-relay-commission-v2'
    ok = $true
    url = $BaseUrl
    mcpUrl = $BaseUrl + '/mcp'
    providerAuthenticationProven = $true
    providerCloudReady = $true
    workstationRequired = $false
    workstationOutageBlocksProviderControl = $false
    desiredStateReconciliationProven = $true
    desiredStateSourceRevision = [string]$Reconcile.sourceRevision
    desiredStateProjectCount = [int]$Reconcile.projectCount
    desiredStateCronMinutes = 5
    githubReadCredentialConfigured = $true
    githubMutationPerformed = $false
    destructiveProviderOperationPerformed = $false
    controlTokenStoredLocally = $true
    controlTokenPathReturned = $false
    vercelTokenStoredInCloudflareSecret = $true
    githubReadTokenStoredInCloudflareSecret = $true
    vercelTokenReturned = $false
    githubTokenReturned = $false
    cloudflareTokenReturned = $false
    credentialValuesReturned = $false
    githubActionsRequired = $false
    paidComputeRequired = $false
}
if ($Json) { $Result | ConvertTo-Json -Compress } else { $Result }
