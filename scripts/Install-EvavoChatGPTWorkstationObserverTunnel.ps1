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
if ($env:OS -ne 'Windows_NT') { throw 'EVAVO ChatGPT workstation observer tunnel installer targets Windows.' }
if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$Observer = Join-Path $Root 'mcp-server\workstation-observer-mcp.mjs'
if (-not (Test-Path -LiteralPath $Observer -PathType Leaf)) { throw 'EVAVO workstation observer MCP is unavailable.' }
$ObserverItem = Get-Item -LiteralPath $Observer -Force -ErrorAction Stop
if (($ObserverItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Workstation observer MCP may not be a reparse point.' }
$Node = Get-Command node.exe,node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$NodeCheck = (& $Node.Source --check $Observer 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "Workstation observer MCP failed Node syntax check. $NodeCheck" }

$TunnelClient = Get-Command tunnel-client.exe,tunnel-client -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $TunnelClient) { throw 'OpenAI tunnel-client is required. Install the supported Secure MCP Tunnel client first.' }
$TunnelExe = [string]$TunnelClient.Source

if (-not $TunnelId) {
    $TunnelId = [Environment]::GetEnvironmentVariable('EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID','User')
    if ([string]::IsNullOrWhiteSpace($TunnelId)) { $TunnelId = [string]$env:EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID }
}
if (-not $WorkspaceId) { $WorkspaceId = [string]$env:OPENAI_WORKSPACE_ID }
if (-not $OrganizationId) { $OrganizationId = [string]$env:OPENAI_ORGANIZATION_ID }
$RuntimeKey = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','User')
if ([string]::IsNullOrWhiteSpace($RuntimeKey)) { $RuntimeKey = $env:CONTROL_PLANE_API_KEY }
if ([string]::IsNullOrWhiteSpace($RuntimeKey)) { $RuntimeKey = [Environment]::GetEnvironmentVariable('OPENAI_API_KEY','User') }
if ([string]::IsNullOrWhiteSpace($RuntimeKey)) { $RuntimeKey = $env:OPENAI_API_KEY }
if ([string]::IsNullOrWhiteSpace($RuntimeKey)) { throw 'A tunnel runtime key is required via CONTROL_PLANE_API_KEY (preferred) or OPENAI_API_KEY fallback.' }

$Created = $false
if ([string]::IsNullOrWhiteSpace($TunnelId)) {
    if (-not $CreateTunnelIfMissing) { throw 'EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID is required unless -CreateTunnelIfMissing is used.' }
    $Admin = [Environment]::GetEnvironmentVariable('OPENAI_ADMIN_KEY','User')
    if ([string]::IsNullOrWhiteSpace($Admin)) { $Admin = $env:OPENAI_ADMIN_KEY }
    if ([string]::IsNullOrWhiteSpace($Admin)) { throw 'OPENAI_ADMIN_KEY is required to create a tunnel automatically.' }
    if ([string]::IsNullOrWhiteSpace($WorkspaceId) -and [string]::IsNullOrWhiteSpace($OrganizationId)) { throw 'WorkspaceId or OrganizationId is required to create a tunnel.' }
    $Args = @('admin','tunnels','create','--name',$TunnelName,'--description','Read-only EVAVO Windows workstation recovery, REST-health and relay observer.','--json')
    if ($WorkspaceId) { $Args += @('--workspace-id',$WorkspaceId) }
    if ($OrganizationId) { $Args += @('--organization-id',$OrganizationId) }
    $Raw = & $TunnelExe @Args 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'OpenAI workstation observer tunnel creation failed.' }
    try { $Doc = $Raw.Trim() | ConvertFrom-Json -ErrorAction Stop } catch { throw 'Tunnel creation returned invalid JSON.' }
    $Candidate = ''
    if ($Doc.PSObject.Properties.Name -contains 'tunnel_id') { $Candidate = [string]$Doc.tunnel_id }
    elseif ($Doc.PSObject.Properties.Name -contains 'id') { $Candidate = [string]$Doc.id }
    if ($Candidate -notmatch '^tunnel_[0-9a-f]{32}$') { throw 'Tunnel creation did not return a valid tunnel id.' }
    $TunnelId = $Candidate
    $Created = $true
    [Environment]::SetEnvironmentVariable('EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID',$TunnelId,'User')
    [Environment]::SetEnvironmentVariable('EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID',$TunnelId,'Process')
}
if ($TunnelId -notmatch '^tunnel_[0-9a-f]{32}$') { throw 'TunnelId must match tunnel_<32 lowercase hex>.' }

if (-not [Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','User') -and $env:CONTROL_PLANE_API_KEY) {
    [Environment]::SetEnvironmentVariable('CONTROL_PLANE_API_KEY',$env:CONTROL_PLANE_API_KEY,'User')
}

$McpCommand = "node `"$Observer`""
$InitRaw = & $TunnelExe init --sample sample_mcp_stdio_local --profile $Profile --tunnel-id $TunnelId --mcp-command $McpCommand 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw 'tunnel-client failed to initialise the EVAVO workstation observer profile.' }
$DoctorRaw = & $TunnelExe doctor --profile $Profile --explain 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw 'tunnel-client doctor rejected the EVAVO workstation observer profile.' }

$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ([string]$Identity.User.Value -eq 'S-1-5-18') { throw 'Workstation observer tunnel must run in the intended interactive user context, not LocalSystem.' }
$UserId = [string]$Identity.Name
$Principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited
$Logon = New-ScheduledTaskTrigger -AtLogOn -User $UserId
$Periodic = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(2)) -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration ([TimeSpan]::MaxValue)
$Settings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval ([TimeSpan]::FromMinutes(1)) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$TaskName = 'EVAVO ChatGPT Workstation Observer Tunnel'
$Arguments = "run --profile $Profile"
$Action = New-ScheduledTaskAction -Execute $TunnelExe -Argument $Arguments -WorkingDirectory $Root
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger @($Logon,$Periodic) -Principal $Principal -Settings $Settings -Description 'Outbound-only OpenAI Secure MCP Tunnel runtime for the read-only EVAVO workstation observer MCP.' -Force | Out-Null
Enable-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-Null
$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$Actions = @($Task.Actions)
$Exact = [bool](
    [string]$Task.State -ne 'Disabled' -and
    [string]$Task.Principal.UserId -eq $UserId -and
    [string]$Task.Principal.RunLevel -eq 'Limited' -and
    $Actions.Count -eq 1 -and
    [IO.Path]::GetFullPath([string]$Actions[0].Execute) -eq [IO.Path]::GetFullPath($TunnelExe) -and
    [string]$Actions[0].Arguments -eq $Arguments
)
if (-not $Exact) { Disable-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null; throw 'Workstation observer tunnel scheduled task failed exact verification.' }
$Started = $false
if ($StartNow) { Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop; $Started = $true }

$Receipt = [ordered]@{
    schemaVersion=1
    kind='evavo-chatgpt-workstation-observer-tunnel-installation-v1'
    ok=$true
    tunnelId=$TunnelId
    tunnelCreated=$Created
    profile=$Profile
    scheduledTaskExact=$true
    limitedInteractiveUser=$true
    startAtLogon=$true
    periodicRecoveryMinutes=15
    started=$Started
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
}
if ($Json) { $Receipt | ConvertTo-Json -Depth 10 } else { $Receipt | ConvertTo-Json -Depth 10 }
