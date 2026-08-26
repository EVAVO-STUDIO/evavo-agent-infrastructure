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

if ($env:OS -ne 'Windows_NT') { throw 'EVAVO_WORKSTATION_OBSERVER_V2_WINDOWS_REQUIRED' }
if (-not $env:LOCALAPPDATA) { throw 'EVAVO_WORKSTATION_OBSERVER_V2_LOCALAPPDATA_REQUIRED' }

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$SourceObserver = Join-Path $Root 'mcp-server\workstation-observer-mcp.mjs'
if (-not (Test-Path -LiteralPath $SourceObserver -PathType Leaf)) { throw 'EVAVO_WORKSTATION_OBSERVER_V2_SOURCE_MISSING' }
$SourceItem = Get-Item -LiteralPath $SourceObserver -Force -ErrorAction Stop
if (($SourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'EVAVO_WORKSTATION_OBSERVER_V2_SOURCE_REPARSE' }

$Node = Get-Command node.exe,node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$TunnelClient = Get-Command tunnel-client.exe,tunnel-client -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $TunnelClient) { throw 'EVAVO_WORKSTATION_OBSERVER_V2_TUNNEL_CLIENT_REQUIRED' }
$TunnelExe = [IO.Path]::GetFullPath([string]$TunnelClient.Source)
$NodeExe = [IO.Path]::GetFullPath([string]$Node.Source)
$NodeCheck = (& $NodeExe --check $SourceObserver 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "EVAVO_WORKSTATION_OBSERVER_V2_SOURCE_NODE_CHECK_FAILED $NodeCheck" }

$ObserverSha = (Get-FileHash -LiteralPath $SourceObserver -Algorithm SHA256).Hash.ToLowerInvariant()
$Base = Join-Path $env:LOCALAPPDATA 'EVAVO\WorkerControlPlane\chatgpt-workstation-observer'
$Bundle = Join-Path (Join-Path $Base 'bundles') $ObserverSha
$InstalledObserver = Join-Path $Bundle 'workstation-observer-mcp.mjs'
$ManifestPath = Join-Path $Bundle 'manifest.json'
New-Item -ItemType Directory -Path $Bundle -Force | Out-Null
Copy-Item -LiteralPath $SourceObserver -Destination $InstalledObserver -Force
$InstalledSha = (Get-FileHash -LiteralPath $InstalledObserver -Algorithm SHA256).Hash.ToLowerInvariant()
if ($InstalledSha -ne $ObserverSha) { throw 'EVAVO_WORKSTATION_OBSERVER_V2_BUNDLE_HASH_MISMATCH' }
$InstalledCheck = (& $NodeExe --check $InstalledObserver 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "EVAVO_WORKSTATION_OBSERVER_V2_BUNDLE_NODE_CHECK_FAILED $InstalledCheck" }

[IO.File]::WriteAllText($ManifestPath,([ordered]@{
    schemaVersion=1
    kind='evavo-chatgpt-workstation-observer-bundle-v2'
    installedAt=[DateTimeOffset]::UtcNow.ToString('o')
    observerSha256=$InstalledSha
    nodeExecutable=$NodeExe
    repositoryIndependent=$true
    developmentCheckoutRequiredAfterInstallation=$false
    readOnly=$true
    mutationAuthority=$false
} | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))

if (-not $TunnelId) {
    $TunnelId = [Environment]::GetEnvironmentVariable('EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID','User')
    if ([string]::IsNullOrWhiteSpace($TunnelId)) { $TunnelId = [string]$env:EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID }
}
if (-not $WorkspaceId) { $WorkspaceId = [string]$env:OPENAI_WORKSPACE_ID }
if (-not $OrganizationId) { $OrganizationId = [string]$env:OPENAI_ORGANIZATION_ID }
$RuntimeKey = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','User')
if ([string]::IsNullOrWhiteSpace($RuntimeKey)) { $RuntimeKey = [string]$env:CONTROL_PLANE_API_KEY }
if ([string]::IsNullOrWhiteSpace($RuntimeKey)) { $RuntimeKey = [Environment]::GetEnvironmentVariable('OPENAI_API_KEY','User') }
if ([string]::IsNullOrWhiteSpace($RuntimeKey)) { $RuntimeKey = [string]$env:OPENAI_API_KEY }
if ([string]::IsNullOrWhiteSpace($RuntimeKey)) { throw 'EVAVO_WORKSTATION_OBSERVER_V2_RUNTIME_KEY_REQUIRED' }

$Created = $false
if ([string]::IsNullOrWhiteSpace($TunnelId)) {
    if (-not $CreateTunnelIfMissing) { throw 'EVAVO_WORKSTATION_OBSERVER_V2_TUNNEL_ID_REQUIRED' }
    $Admin = [Environment]::GetEnvironmentVariable('OPENAI_ADMIN_KEY','User')
    if ([string]::IsNullOrWhiteSpace($Admin)) { $Admin = [string]$env:OPENAI_ADMIN_KEY }
    if ([string]::IsNullOrWhiteSpace($Admin)) { throw 'EVAVO_WORKSTATION_OBSERVER_V2_ADMIN_KEY_REQUIRED' }
    if ([string]::IsNullOrWhiteSpace($WorkspaceId) -and [string]::IsNullOrWhiteSpace($OrganizationId)) { throw 'EVAVO_WORKSTATION_OBSERVER_V2_SCOPE_REQUIRED' }
    $Args = @('admin','tunnels','create','--name',$TunnelName,'--description','Read-only EVAVO Windows workstation recovery, REST-health and relay observer.','--json')
    if ($WorkspaceId) { $Args += @('--workspace-id',$WorkspaceId) }
    if ($OrganizationId) { $Args += @('--organization-id',$OrganizationId) }
    $Raw = (& $TunnelExe @Args 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'EVAVO_WORKSTATION_OBSERVER_V2_TUNNEL_CREATE_FAILED' }
    $Doc = $Raw | ConvertFrom-Json -ErrorAction Stop
    $Candidate = if ($Doc.PSObject.Properties.Name -contains 'tunnel_id') { [string]$Doc.tunnel_id } elseif ($Doc.PSObject.Properties.Name -contains 'id') { [string]$Doc.id } else { '' }
    if ($Candidate -notmatch '^tunnel_[0-9a-f]{32}$') { throw 'EVAVO_WORKSTATION_OBSERVER_V2_TUNNEL_ID_INVALID' }
    $TunnelId = $Candidate
    $Created = $true
    [Environment]::SetEnvironmentVariable('EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID',$TunnelId,'User')
    [Environment]::SetEnvironmentVariable('EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID',$TunnelId,'Process')
}
if ($TunnelId -notmatch '^tunnel_[0-9a-f]{32}$') { throw 'EVAVO_WORKSTATION_OBSERVER_V2_TUNNEL_ID_INVALID' }
if (-not [Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','User') -and $env:CONTROL_PLANE_API_KEY) {
    [Environment]::SetEnvironmentVariable('CONTROL_PLANE_API_KEY',$env:CONTROL_PLANE_API_KEY,'User')
}

$McpCommand = "`"$NodeExe`" `"$InstalledObserver`""
$InitRaw = (& $TunnelExe init --sample sample_mcp_stdio_local --profile $Profile --tunnel-id $TunnelId --mcp-command $McpCommand 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'EVAVO_WORKSTATION_OBSERVER_V2_INIT_FAILED' }
$DoctorRaw = (& $TunnelExe doctor --profile $Profile --explain 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'EVAVO_WORKSTATION_OBSERVER_V2_DOCTOR_FAILED' }

$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ([string]$Identity.User.Value -eq 'S-1-5-18') { throw 'EVAVO_WORKSTATION_OBSERVER_V2_INTERACTIVE_USER_REQUIRED' }
$UserId = [string]$Identity.Name
$TaskName = 'EVAVO ChatGPT Workstation Observer Tunnel'
$Arguments = "run --profile $Profile"
$Principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited
$Logon = New-ScheduledTaskTrigger -AtLogOn -User $UserId
$Periodic = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(2)) -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration ([TimeSpan]::MaxValue)
$Settings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval ([TimeSpan]::FromMinutes(1)) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$Action = New-ScheduledTaskAction -Execute $TunnelExe -Argument $Arguments -WorkingDirectory $Bundle
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger @($Logon,$Periodic) -Principal $Principal -Settings $Settings -Description 'Outbound-only OpenAI Secure MCP Tunnel runtime for the repository-independent read-only EVAVO workstation observer MCP.' -Force | Out-Null
Enable-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-Null
$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$Actions = @($Task.Actions)
$Exact = [bool]([string]$Task.State -ne 'Disabled' -and [string]$Task.Principal.UserId -eq $UserId -and [string]$Task.Principal.RunLevel -eq 'Limited' -and $Actions.Count -eq 1 -and [IO.Path]::GetFullPath([string]$Actions[0].Execute) -eq $TunnelExe -and [string]$Actions[0].Arguments -eq $Arguments -and [IO.Path]::GetFullPath([string]$Actions[0].WorkingDirectory) -eq [IO.Path]::GetFullPath($Bundle))
if (-not $Exact) { Disable-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null; throw 'EVAVO_WORKSTATION_OBSERVER_V2_TASK_INVALID' }
$Started = $false
if ($StartNow) { Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop; $Started = $true }

[ordered]@{
    schemaVersion=2
    kind='evavo-chatgpt-workstation-observer-tunnel-installation-v2'
    ok=$true
    tunnelCreated=$Created
    tunnelIdReturned=$false
    profile=$Profile
    scheduledTaskExact=$true
    limitedInteractiveUser=$true
    startAtLogon=$true
    periodicRecoveryMinutes=15
    started=$Started
    observerSha256=$InstalledSha
    immutableObserverBundle=$true
    repositoryIndependentObserver=$true
    developmentCheckoutRequiredAfterInstallation=$false
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
} | ConvertTo-Json -Depth 10
