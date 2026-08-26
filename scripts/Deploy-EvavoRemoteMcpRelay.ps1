[CmdletBinding()]
param(
    [string]$RelayBaseUrl = '',
    [string]$LocalStorageRoot = '',
    [switch]$SkipPackageInstall,
    [switch]$SkipWorkstationClientInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:OS -ne 'Windows_NT') { throw 'EVAVO_REMOTE_MCP_RELAY_DEPLOY_WINDOWS_REQUIRED' }

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$Package = Join-Path $Root 'packages\remote-mcp-relay'
$PackageJson = Join-Path $Package 'package.json'
$WranglerConfig = Join-Path $Package 'wrangler.jsonc'
$WorkerSource = Join-Path $Package 'src\worker.ts'
foreach ($Path in @($PackageJson,$WranglerConfig,$WorkerSource)) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "EVAVO_REMOTE_MCP_RELAY_DEPLOY_SOURCE_MISSING:$Path" }
}
$Npm = (Get-Command npm.cmd,npm -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$Npx = (Get-Command npx.cmd,npx -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source

function Invoke-NativeChecked {
    param([Parameter(Mandatory=$true)][string]$File,[Parameter(Mandatory=$true)][string[]]$Arguments,[string]$WorkingDirectory=$Package)
    Push-Location -LiteralPath $WorkingDirectory
    try {
        $Previous = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $global:LASTEXITCODE = 0
            $Output = @(& $File @Arguments 2>&1)
            $Code = [int]$global:LASTEXITCODE
        }
        finally { $ErrorActionPreference = $Previous }
        if ($Code -ne 0) {
            $Text = (($Output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
            if ($Text.Length -gt 4000) { $Text = $Text.Substring($Text.Length-4000) }
            throw "Native command failed ($Code): $($Arguments -join ' ') $Text"
        }
        return (($Output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine).Trim()
    }
    finally { Pop-Location }
}

function New-RandomHex {
    param([int]$Bytes=32)
    $Buffer = New-Object byte[] $Bytes
    $Rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $Rng.GetBytes($Buffer); return (($Buffer | ForEach-Object { $_.ToString('x2') }) -join '') }
    finally { $Rng.Dispose(); [Array]::Clear($Buffer,0,$Buffer.Length) }
}

function Put-WorkerSecret {
    param([Parameter(Mandatory=$true)][string]$Name,[Parameter(Mandatory=$true)][string]$Value)
    Push-Location -LiteralPath $Package
    try {
        $Previous = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $global:LASTEXITCODE = 0
            $Output = @($Value | & $Npx wrangler secret put $Name 2>&1)
            $Code = [int]$global:LASTEXITCODE
        }
        finally { $ErrorActionPreference = $Previous }
        if ($Code -ne 0) { throw "Wrangler secret put failed for $Name." }
    }
    finally { Pop-Location }
}

function Find-HttpsUrl {
    param($Value)
    $Found = New-Object Collections.Generic.List[string]
    function Walk($Node) {
        if ($null -eq $Node) { return }
        if ($Node -is [string]) {
            foreach ($Match in [regex]::Matches([string]$Node,'https://[A-Za-z0-9.-]+(?:/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*)?')) { $Found.Add($Match.Value.TrimEnd('/')) }
            return
        }
        if ($Node -is [Collections.IDictionary]) { foreach ($Key in $Node.Keys) { Walk $Node[$Key] }; return }
        if ($Node -is [Collections.IEnumerable] -and -not ($Node -is [string])) { foreach ($Item in $Node) { Walk $Item }; return }
        foreach ($Property in @($Node.PSObject.Properties)) { Walk $Property.Value }
    }
    Walk $Value
    return @($Found | Where-Object { $_ -match '\.workers\.dev(?:/|$)' } | Select-Object -Unique)
}

if (-not $SkipPackageInstall) {
    Invoke-NativeChecked -File $Npm -Arguments @('install','--no-audit','--no-fund','--no-package-lock') | Out-Null
}
Invoke-NativeChecked -File $Npx -Arguments @('wrangler','whoami') | Out-Null
$DryRun = Join-Path $env:TEMP ("evavo-remote-mcp-relay-dryrun-"+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $DryRun -Force | Out-Null
try { Invoke-NativeChecked -File $Npx -Arguments @('wrangler','deploy','--dry-run','--outdir',$DryRun) | Out-Null }
finally { Remove-Item -LiteralPath $DryRun -Recurse -Force -ErrorAction SilentlyContinue }

# First deployment creates/reconciles the Worker and SQLite Durable Object namespace.
$InitialRaw = Invoke-NativeChecked -File $Npx -Arguments @('wrangler','deploy','--json')
try { $Initial = $InitialRaw | ConvertFrom-Json -ErrorAction Stop } catch { throw 'EVAVO_REMOTE_MCP_RELAY_DEPLOY_INITIAL_JSON_INVALID' }

$WorkstationSecret = New-RandomHex -Bytes 32
$DispatchSecret = New-RandomHex -Bytes 32
try {
    Put-WorkerSecret -Name 'WORKSTATION_TOKEN' -Value $WorkstationSecret
    Put-WorkerSecret -Name 'DISPATCH_TOKEN' -Value $DispatchSecret
    $FinalRaw = Invoke-NativeChecked -File $Npx -Arguments @('wrangler','deploy','--json')
    try { $Final = $FinalRaw | ConvertFrom-Json -ErrorAction Stop } catch { throw 'EVAVO_REMOTE_MCP_RELAY_DEPLOY_FINAL_JSON_INVALID' }

    if ([string]::IsNullOrWhiteSpace($RelayBaseUrl)) {
        $Candidates = @(Find-HttpsUrl -Value $Final)
        if ($Candidates.Count -lt 1) { $Candidates = @(Find-HttpsUrl -Value $Initial) }
        if ($Candidates.Count -ne 1) { throw 'EVAVO_REMOTE_MCP_RELAY_DEPLOY_URL_AMBIGUOUS; rerun with -RelayBaseUrl using the production workers.dev URL.' }
        $RelayBaseUrl = $Candidates[0]
    }
    $BaseUri = [Uri]$RelayBaseUrl
    if ($BaseUri.Scheme -ne 'https' -or $BaseUri.Query -or $BaseUri.Fragment) { throw 'EVAVO_REMOTE_MCP_RELAY_DEPLOY_BASE_URL_INVALID' }
    $RelayBaseUrl = $BaseUri.GetLeftPart([UriPartial]::Authority).TrimEnd('/')
    $Health = Invoke-RestMethod -Method GET -Uri "$RelayBaseUrl/health" -TimeoutSec 20 -ErrorAction Stop
    if ($Health.ok -ne $true -or [string]$Health.service -ne 'evavo-workstation-mcp-relay') { throw 'EVAVO_REMOTE_MCP_RELAY_DEPLOY_HEALTH_FAILED' }

    $ClientInstalled = $false
    $ClientReceipt = $null
    if (-not $SkipWorkstationClientInstall) {
        if ([string]::IsNullOrWhiteSpace($LocalStorageRoot)) {
            $Candidates = @(
                (Join-Path $env:LOCALAPPDATA 'EVAVO\WorkerControlPlane\zero-cost-updater\runtime\evavo-local-storage'),
                (Join-Path $env:LOCALAPPDATA 'EVAVO\WorkerControlPlane\zero-cost-recovery\runtime\evavo-local-storage'),
                (Join-Path $env:LOCALAPPDATA 'EVAVO\WorkerControlPlane\zero-cost-logon-guardian\runtime\evavo-local-storage'),
                'C:\GitRepos\evavo-local-storage'
            )
            foreach ($Candidate in $Candidates) {
                if (Test-Path -LiteralPath (Join-Path $Candidate 'scripts\Install-EvavoRemoteMcpRelayClient.ps1') -PathType Leaf) { $LocalStorageRoot=$Candidate; break }
            }
        }
        if ([string]::IsNullOrWhiteSpace($LocalStorageRoot)) { throw 'EVAVO_REMOTE_MCP_RELAY_DEPLOY_LOCAL_STORAGE_SOURCE_UNAVAILABLE' }
        $Installer = Join-Path $LocalStorageRoot 'scripts\Install-EvavoRemoteMcpRelayClient.ps1'
        if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw 'EVAVO_REMOTE_MCP_RELAY_DEPLOY_CLIENT_INSTALLER_MISSING' }
        $Wss = [UriBuilder]$RelayBaseUrl
        $Wss.Scheme='wss'; $Wss.Port=-1; $Wss.Path='/connect'
        $Secure = ConvertTo-SecureString -String $WorkstationSecret -AsPlainText -Force
        $PowerShell = (Get-Command powershell.exe -CommandType Application -ErrorAction Stop).Source
        # Invoke in-process so SecureString never appears in child-process command arguments.
        $InstallResult = & $Installer -Endpoint $Wss.Uri -WorkstationToken $Secure -StartNow | Out-String
        if ($LASTEXITCODE -ne 0 -or -not $InstallResult.Trim()) { throw 'EVAVO_REMOTE_MCP_RELAY_DEPLOY_CLIENT_INSTALL_FAILED' }
        $ClientReceipt = $InstallResult.Trim() | ConvertFrom-Json -ErrorAction Stop
        if ($ClientReceipt.ok -ne $true -or $ClientReceipt.tokenProtectedWithDpapiCurrentUser -ne $true -or $ClientReceipt.outboundOnly -ne $true) { throw 'EVAVO_REMOTE_MCP_RELAY_DEPLOY_CLIENT_RECEIPT_INVALID' }
        $ClientInstalled = $true
    }

    [ordered]@{
        schemaVersion=1
        kind='evavo-remote-mcp-relay-deployment'
        ok=$true
        relayBaseUrl=$RelayBaseUrl
        mcpUrl="$RelayBaseUrl/mcp"
        healthUrl="$RelayBaseUrl/health"
        workstationConnectUrl=($RelayBaseUrl -replace '^https://','wss://')+'/connect'
        dryRunPassed=$true
        cloudflareDeployPassed=$true
        requiredSecretsProvisioned=$true
        workstationSecretReturned=$false
        dispatchSecretReturned=$false
        workstationClientInstalled=$ClientInstalled
        workstationClient=if($ClientReceipt){$ClientReceipt}else{$null}
        currentChatGptProMcpSurface='read-only-status-capabilities-request-status'
        effectfulDispatchIsSeparateApi=$true
        githubActionsRequired=$false
        vercelRequired=$false
        paidRelayRequired=$false
        physicalWorkstationConnectionProven=$false
    } | ConvertTo-Json -Depth 12
}
finally {
    $WorkstationSecret = $null
    $DispatchSecret = $null
}
