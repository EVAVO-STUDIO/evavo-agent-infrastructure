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

$Tunnel = Get-Command tunnel-client.exe,tunnel-client -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$Info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
$TunnelId = [Environment]::GetEnvironmentVariable('EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID','User')
if ([string]::IsNullOrWhiteSpace($TunnelId)) { $TunnelId = [string]$env:EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID }
$TunnelIdConfigured = [bool]($TunnelId -match '^tunnel_[0-9a-f]{32}$')
$TaskExact = $false
if ($Task -and $Tunnel) {
    $Actions = @($Task.Actions)
    $TaskExact = [bool](
        [string]$Task.State -ne 'Disabled' -and
        [string]$Task.Principal.RunLevel -eq 'Limited' -and
        $Actions.Count -eq 1 -and
        [IO.Path]::GetFullPath([string]$Actions[0].Execute) -eq [IO.Path]::GetFullPath([string]$Tunnel.Source) -and
        [string]$Actions[0].Arguments -eq "run --profile $Profile"
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
    schemaVersion=1
    kind='evavo-chatgpt-workstation-observer-tunnel-status-v1'
    ok=[bool]($Tunnel -and $TunnelIdConfigured -and $TaskExact)
    checkedAt=[DateTimeOffset]::UtcNow.ToString('o')
    profile=$Profile
    tunnelClientAvailable=[bool]$Tunnel
    tunnelIdConfigured=$TunnelIdConfigured
    tunnelIdReturned=$false
    runtimeKeyConfigured=[bool](-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','User')) -or -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('OPENAI_API_KEY','User')))
    runtimeKeyReturned=$false
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
