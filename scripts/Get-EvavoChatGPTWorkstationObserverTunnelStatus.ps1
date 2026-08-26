[CmdletBinding()]
param(
    [string]$Profile = 'evavo-workstation-observer',
    [string]$TaskName = 'EVAVO ChatGPT Workstation Observer Tunnel',
    [switch]$ProbeDoctor
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:OS -ne 'Windows_NT') { throw 'EVAVO workstation observer tunnel status targets Windows.' }
if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required.' }

$Tunnel = Get-Command tunnel-client.exe,tunnel-client -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$Info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
$TunnelId = [Environment]::GetEnvironmentVariable('EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID','User')
if ([string]::IsNullOrWhiteSpace($TunnelId)) { $TunnelId = [string]$env:EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID }
$TunnelIdConfigured = [bool]($TunnelId -match '^tunnel_[0-9a-f]{32}$')

$Base = Join-Path $env:LOCALAPPDATA 'EVAVO\WorkerControlPlane\chatgpt-workstation-observer'
$BundleRoot = Join-Path $Base 'bundles'
$BundleValid = $false
$BundleSha = $null
$BundlePath = $null
if (Test-Path -LiteralPath $BundleRoot -PathType Container) {
    foreach ($Directory in @(Get-ChildItem -LiteralPath $BundleRoot -Directory -Force -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending)) {
        if ($Directory.Name -notmatch '^[a-f0-9]{64}$') { continue }
        $ManifestPath = Join-Path $Directory.FullName 'manifest.json'
        $ObserverPath = Join-Path $Directory.FullName 'workstation-observer-mcp.mjs'
        if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf) -or -not (Test-Path -LiteralPath $ObserverPath -PathType Leaf)) { continue }
        try {
            $Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
            $Actual = (Get-FileHash -LiteralPath $ObserverPath -Algorithm SHA256).Hash.ToLowerInvariant()
            if (
                [int]$Manifest.schemaVersion -eq 1 -and
                [string]$Manifest.kind -eq 'evavo-chatgpt-workstation-observer-bundle-v2' -and
                $Manifest.repositoryIndependent -eq $true -and
                $Manifest.developmentCheckoutRequiredAfterInstallation -eq $false -and
                $Manifest.readOnly -eq $true -and
                $Manifest.mutationAuthority -eq $false -and
                [string]$Manifest.observerSha256 -eq $Actual -and
                $Directory.Name -eq $Actual
            ) {
                $BundleValid=$true; $BundleSha=$Actual; $BundlePath=$Directory.FullName; break
            }
        } catch {}
    }
}

$TaskExact = $false
if ($Task -and $Tunnel) {
    $Actions = @($Task.Actions)
    $TaskExact = [bool](
        [string]$Task.State -ne 'Disabled' -and
        [string]$Task.Principal.RunLevel -eq 'Limited' -and
        $Actions.Count -eq 1 -and
        [IO.Path]::GetFullPath([string]$Actions[0].Execute) -eq [IO.Path]::GetFullPath([string]$Tunnel.Source) -and
        [string]$Actions[0].Arguments -eq "run --profile $Profile" -and
        ($null -eq $BundlePath -or [IO.Path]::GetFullPath([string]$Actions[0].WorkingDirectory) -eq [IO.Path]::GetFullPath($BundlePath))
    )
}

$DoctorAttempted = $false
$DoctorPassed = $false
if ($ProbeDoctor -and $Tunnel -and $TunnelIdConfigured) {
    $DoctorAttempted = $true
    $Output = (& $Tunnel.Source doctor --profile $Profile --explain 2>&1 | Out-String).Trim()
    $DoctorPassed = $LASTEXITCODE -eq 0
}

[ordered]@{
    schemaVersion=2
    kind='evavo-chatgpt-workstation-observer-tunnel-status-v2'
    ok=[bool]($Tunnel -and $TunnelIdConfigured -and $TaskExact -and $BundleValid)
    checkedAt=[DateTimeOffset]::UtcNow.ToString('o')
    profile=$Profile
    tunnelClientAvailable=[bool]$Tunnel
    tunnelIdConfigured=$TunnelIdConfigured
    tunnelIdReturned=$false
    runtimeKeyConfigured=[bool](-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','User')) -or -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('OPENAI_API_KEY','User')))
    runtimeKeyReturned=$false
    observerBundle=[ordered]@{
        valid=$BundleValid
        sha256=$BundleSha
        repositoryIndependent=$BundleValid
        developmentCheckoutRequiredAfterInstallation=$false
        observerPathReturned=$false
    }
    task=[ordered]@{
        installed=[bool]$Task
        state=if($Task){[string]$Task.State}else{'NotInstalled'}
        exact=$TaskExact
        lastTaskResult=if($Info){[long]$Info.LastTaskResult}else{$null}
        lastRunTime=if($Info -and $Info.LastRunTime -gt [DateTime]::MinValue){$Info.LastRunTime.ToUniversalTime().ToString('o')}else{$null}
        nextRunTime=if($Info -and $Info.NextRunTime -gt [DateTime]::MinValue){$Info.NextRunTime.ToUniversalTime().ToString('o')}else{$null}
    }
    doctorAttempted=$DoctorAttempted
    doctorPassed=$DoctorPassed
    networkProbePerformed=[bool]$DoctorAttempted
    outboundOnly=$true
    observerReadOnly=$true
    mutationAuthority=$false
    rawShellExposed=$false
    credentialValuesReturned=$false
    chatGptConnectorRegistrationPerformed=$false
    chatGptProductSideConnectorSetupStillRequired=$true
    physicalTunnelReachabilityClaimed=[bool]($DoctorAttempted -and $DoctorPassed)
} | ConvertTo-Json -Depth 10
