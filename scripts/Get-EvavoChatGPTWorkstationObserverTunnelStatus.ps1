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
$WScript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$WScriptAvailable = Test-Path -LiteralPath $WScript -PathType Leaf
$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$Info = if ($Task) { Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue } else { $null }
$TunnelId = [Environment]::GetEnvironmentVariable('EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID','User')
if ([string]::IsNullOrWhiteSpace($TunnelId)) { $TunnelId = [string]$env:EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID }
$TunnelIdConfigured = [bool]($TunnelId -match '^tunnel_[0-9a-f]{32}$')

$Base = Join-Path $env:LOCALAPPDATA 'EVAVO\WorkerControlPlane\chatgpt-workstation-observer'
$BundleRoot = Join-Path $Base 'bundles'
$BundleValid = $false
$BundleSha = $null
$BundlePath = $null
$TaskLauncherPath = $null
$TaskLauncherHashValid = $false
if (Test-Path -LiteralPath $BundleRoot -PathType Container) {
    foreach ($Directory in @(Get-ChildItem -LiteralPath $BundleRoot -Directory -Force -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending)) {
        if ($Directory.Name -notmatch '^[a-f0-9]{64}$') { continue }
        $ManifestPath = Join-Path $Directory.FullName 'manifest.json'
        $ObserverPath = Join-Path $Directory.FullName 'workstation-observer-mcp.mjs'
        $LauncherPath = Join-Path $Directory.FullName 'run-workstation-observer-tunnel-hidden.vbs'
        if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf) -or -not (Test-Path -LiteralPath $ObserverPath -PathType Leaf) -or -not (Test-Path -LiteralPath $LauncherPath -PathType Leaf)) { continue }
        try {
            $Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
            $Actual = (Get-FileHash -LiteralPath $ObserverPath -Algorithm SHA256).Hash.ToLowerInvariant()
            $LauncherActual = (Get-FileHash -LiteralPath $LauncherPath -Algorithm SHA256).Hash.ToLowerInvariant()
            $LauncherItem = Get-Item -LiteralPath $LauncherPath -Force -ErrorAction Stop
            $LauncherSafe = [bool](-not $LauncherItem.PSIsContainer -and (($LauncherItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0))
            if (
                [int]$Manifest.schemaVersion -eq 2 -and
                [string]$Manifest.kind -eq 'evavo-chatgpt-workstation-observer-bundle-v2' -and
                $Manifest.repositoryIndependent -eq $true -and
                $Manifest.developmentCheckoutRequiredAfterInstallation -eq $false -and
                $Manifest.readOnly -eq $true -and
                $Manifest.mutationAuthority -eq $false -and
                $Manifest.mcpCommandUsesDirectNode -eq $true -and
                [string]$Manifest.scheduledTaskHost -eq 'wscript.exe' -and
                $Manifest.scheduledTaskWaitsForTunnelExit -eq $true -and
                $Manifest.directTunnelClientScheduledHost -eq $false -and
                [string]$Manifest.observerSha256 -eq $Actual -and
                [string]$Manifest.taskLauncherSha256 -eq $LauncherActual -and
                $LauncherSafe -and
                $Directory.Name -eq $Actual
            ) {
                $BundleValid=$true; $BundleSha=$Actual; $BundlePath=$Directory.FullName; $TaskLauncherPath=$LauncherPath; $TaskLauncherHashValid=$true; break
            }
        } catch {}
    }
}

$TaskExact = $false
$TaskConsoleFree = $false
$DirectTunnelClientScheduledHost = $false
if ($Task) {
    $Actions = @($Task.Actions)
    if ($Actions.Count -eq 1) {
        $ObservedExecute = [IO.Path]::GetFullPath([string]$Actions[0].Execute)
        $DirectTunnelClientScheduledHost = [bool]($Tunnel -and $ObservedExecute -eq [IO.Path]::GetFullPath([string]$Tunnel.Source))
        if ($WScriptAvailable -and $TaskLauncherPath -and $BundlePath) {
            $ExpectedArguments = ('//B //NoLogo "{0}"' -f $TaskLauncherPath)
            $TaskExact = [bool](
                [string]$Task.State -ne 'Disabled' -and
                [string]$Task.Principal.RunLevel -eq 'Limited' -and
                $ObservedExecute -eq [IO.Path]::GetFullPath($WScript) -and
                [string]$Actions[0].Arguments -eq $ExpectedArguments -and
                [IO.Path]::GetFullPath([string]$Actions[0].WorkingDirectory) -eq [IO.Path]::GetFullPath($BundlePath) -and
                $TaskLauncherHashValid
            )
            $TaskConsoleFree = $TaskExact
        }
    }
}

$DoctorAttempted = $false
$DoctorPassed = $false
if ($ProbeDoctor -and $Tunnel -and $TunnelIdConfigured) {
    $DoctorAttempted = $true
    $Previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $Output = (& $Tunnel.Source doctor --profile $Profile --explain 2>&1 | Out-String).Trim()
        $DoctorPassed = $LASTEXITCODE -eq 0
    } finally {
        $ErrorActionPreference = $Previous
    }
}

$InstalledReady = [bool]($Tunnel -and $TunnelIdConfigured -and $TaskExact -and $BundleValid)
# When the caller explicitly asks for a live doctor probe, its result is part of
# readiness. A valid installed bundle must not mask a failed or impossible probe.
$RuntimeReady = [bool]($InstalledReady -and (-not $ProbeDoctor -or ($DoctorAttempted -and $DoctorPassed)))

[ordered]@{
    schemaVersion=4
    kind='evavo-chatgpt-workstation-observer-tunnel-status-v4'
    ok=$RuntimeReady
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
        mcpCommandUsesDirectNode=$BundleValid
        taskLauncherHashValid=$TaskLauncherHashValid
        observerPathReturned=$false
    }
    task=[ordered]@{
        installed=[bool]$Task
        state=if($Task){[string]$Task.State}else{'NotInstalled'}
        exact=$TaskExact
        host=if($TaskConsoleFree){'wscript.exe'}else{$null}
        consoleFree=$TaskConsoleFree
        directTunnelClientScheduledHost=$DirectTunnelClientScheduledHost
        waitsForTunnelExit=$TaskConsoleFree
        lastTaskResult=if($Info){[long]$Info.LastTaskResult}else{$null}
        lastRunTime=if($Info -and $Info.LastRunTime -gt [DateTime]::MinValue){$Info.LastRunTime.ToUniversalTime().ToString('o')}else{$null}
        nextRunTime=if($Info -and $Info.NextRunTime -gt [DateTime]::MinValue){$Info.NextRunTime.ToUniversalTime().ToString('o')}else{$null}
    }
    doctorRequested=[bool]$ProbeDoctor
    doctorAttempted=$DoctorAttempted
    doctorPassed=$DoctorPassed
    networkProbePerformed=[bool]$DoctorAttempted
    executionReadyByInstalledState=$InstalledReady
    executionReadyByTunnelDoctor=if($ProbeDoctor){[bool]($DoctorAttempted -and $DoctorPassed)}else{$null}
    runtimeReadinessProbed=[bool]$ProbeDoctor
    runtimeReady=$RuntimeReady
    readinessBasis=if($ProbeDoctor){'installed-state-and-tunnel-doctor'}else{'installed-state-only'}
    outboundOnly=$true
    observerReadOnly=$true
    mutationAuthority=$false
    rawShellExposed=$false
    focusStealAllowed=$false
    credentialValuesReturned=$false
    chatGptConnectorRegistrationPerformed=$false
    chatGptProductSideConnectorSetupStillRequired=$true
    physicalTunnelReachabilityClaimed=[bool]($DoctorAttempted -and $DoctorPassed)
} | ConvertTo-Json -Depth 10
