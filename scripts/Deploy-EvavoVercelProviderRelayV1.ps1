[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$Json
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($RepositoryRoot)).TrimEnd('\')
$Package = Join-Path $Root 'packages\vercel-provider-relay'
$Config = Join-Path $Package 'wrangler.jsonc'
$Worker = Join-Path $Package 'src\worker.ts'
foreach ($Path in @($Package,$Config,$Worker)) { if (-not (Test-Path -LiteralPath $Path)) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_SOURCE_MISSING' } }

$CfToken = [string]$(if ($env:CLOUDFLARE_API_TOKEN) { $env:CLOUDFLARE_API_TOKEN } else { $env:CF_API_TOKEN })
$VercelToken = [string]$(if ($env:VERCEL_TOKEN) { $env:VERCEL_TOKEN } else { $env:VERCEL_API_TOKEN })
if ([string]::IsNullOrWhiteSpace($CfToken)) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_CLOUDFLARE_TOKEN_REQUIRED' }
if ([string]::IsNullOrWhiteSpace($VercelToken)) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_VERCEL_TOKEN_REQUIRED' }

$Node = (Get-Command node.exe,node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$Npm = (Get-Command npm.cmd,npm -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$Wrangler = Join-Path $Package 'node_modules\.bin\wrangler.cmd'
if (-not (Test-Path -LiteralPath $Wrangler -PathType Leaf)) {
    & $Npm install --no-audit --no-fund --ignore-scripts --prefix $Package | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Wrangler -PathType Leaf)) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_DEPENDENCIES_FAILED' }
}

$StateRoot = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'EVAVO\VercelProviderRelay' } else { Join-Path $env:TEMP 'EVAVO\VercelProviderRelay' }
New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
$TokenPath = Join-Path $StateRoot 'control-token.txt'
if (Test-Path -LiteralPath $TokenPath -PathType Leaf) {
    $ControlToken = (Get-Content -LiteralPath $TokenPath -Raw -Encoding UTF8).Trim()
} else {
    $Bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($Bytes)
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
    $Deploy = (& $Wrangler deploy --config $Config 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_DEPLOY_FAILED' }
} finally {
    $env:CLOUDFLARE_API_TOKEN = $PreviousCf
}

$UrlMatch = [regex]::Matches($Deploy,'https://[A-Za-z0-9.-]+\.workers\.dev') | Select-Object -Last 1
if ($null -eq $UrlMatch) { throw 'EVAVO_VERCEL_PROVIDER_RELAY_URL_NOT_OBSERVED' }
$BaseUrl = [string]$UrlMatch.Value
$Health = Invoke-RestMethod -Uri ($BaseUrl + '/health') -Method Get -TimeoutSec 30
if ($Health.ok -ne $true -or $Health.workstationRequired -ne $false -or $Health.providerCredentialConfigured -ne $true -or $Health.controlCredentialConfigured -ne $true) {
    throw 'EVAVO_VERCEL_PROVIDER_RELAY_HEALTH_NOT_PROVEN'
}
$ProbeBody = @{ request = @{ operation = 'project.list'; query = @{ limit = 1 } }; execute = $false } | ConvertTo-Json -Depth 8 -Compress
$Probe = Invoke-RestMethod -Uri ($BaseUrl + '/api/control') -Method Post -Headers @{ Authorization = "Bearer $ControlToken" } -ContentType 'application/json' -Body $ProbeBody -TimeoutSec 45
if ($Probe.ok -ne $true -or $Probe.status -ne 'completed' -or $Probe.executed -ne $true -or $Probe.operation -ne 'project.list') {
    throw 'EVAVO_VERCEL_PROVIDER_RELAY_PROVIDER_PROBE_FAILED'
}
$Result = [ordered]@{
    schemaVersion = 1
    kind = 'evavo-vercel-provider-relay-commission-v1'
    ok = $true
    url = $BaseUrl
    mcpUrl = $BaseUrl + '/mcp'
    providerAuthenticationProven = $true
    workstationRequired = $false
    controlTokenStoredLocally = $true
    controlTokenPathReturned = $false
    vercelTokenStoredInCloudflareSecret = $true
    vercelTokenReturned = $false
    cloudflareTokenReturned = $false
    credentialValuesReturned = $false
    githubActionsRequired = $false
    paidComputeRequired = $false
}
if ($Json) { $Result | ConvertTo-Json -Compress } else { $Result }
