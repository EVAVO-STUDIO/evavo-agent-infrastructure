[CmdletBinding()]
param(
    [string]$Profile = 'evavo-android-observer',
    [string]$TunnelName = 'EVAVO Android Observer',
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
if ($env:OS -ne 'Windows_NT') { throw 'EVAVO ChatGPT Android observer tunnel installer currently targets Windows.' }
if (-not $env:USERPROFILE -or -not $env:LOCALAPPDATA) { throw 'USERPROFILE and LOCALAPPDATA are required.' }

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$Observer = Join-Path $Root 'mcp-server\android-observer-mcp.mjs'
if (-not (Test-Path -LiteralPath $Observer -PathType Leaf)) { throw 'EVAVO Android observer MCP is unavailable.' }
$ObserverItem=Get-Item -LiteralPath $Observer -Force -ErrorAction Stop
if(($ObserverItem.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){throw 'Android observer MCP may not be a reparse point.'}
$Node = Get-Command node.exe,node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$TunnelClient = Get-Command tunnel-client.exe,tunnel-client -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $TunnelClient) { throw 'OpenAI tunnel-client is required. Install the supported Secure MCP Tunnel client first.' }
$TunnelExe=[IO.Path]::GetFullPath([string]$TunnelClient.Source)
$NodeExe=[IO.Path]::GetFullPath([string]$Node.Source)
$WScript=Join-Path $env:SystemRoot 'System32\wscript.exe'
if(-not(Test-Path -LiteralPath $WScript -PathType Leaf)){throw 'EVAVO_ANDROID_OBSERVER_WSCRIPT_REQUIRED'}
$NodeCheck=(& $NodeExe --check $Observer 2>&1|Out-String).Trim()
if($LASTEXITCODE-ne0){throw 'EVAVO_ANDROID_OBSERVER_NODE_CHECK_FAILED'}

if (-not $TunnelId) {
    $TunnelId = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_TUNNEL_ID','User')
    if ([string]::IsNullOrWhiteSpace($TunnelId)) { $TunnelId = [string]$env:CONTROL_PLANE_TUNNEL_ID }
}
if (-not $WorkspaceId) { $WorkspaceId = [string]$env:OPENAI_WORKSPACE_ID }
if (-not $OrganizationId) { $OrganizationId = [string]$env:OPENAI_ORGANIZATION_ID }
$runtimeKey = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','User')
if ([string]::IsNullOrWhiteSpace($runtimeKey)) { $runtimeKey = $env:CONTROL_PLANE_API_KEY }
if ([string]::IsNullOrWhiteSpace($runtimeKey)) { $runtimeKey = [Environment]::GetEnvironmentVariable('OPENAI_API_KEY','User') }
if ([string]::IsNullOrWhiteSpace($runtimeKey)) { $runtimeKey = $env:OPENAI_API_KEY }
if ([string]::IsNullOrWhiteSpace($runtimeKey)) { throw 'A tunnel runtime key is required via CONTROL_PLANE_API_KEY (preferred) or OPENAI_API_KEY fallback.' }

$created=$false
if ([string]::IsNullOrWhiteSpace($TunnelId)) {
    if (-not $CreateTunnelIfMissing) { throw 'CONTROL_PLANE_TUNNEL_ID is required unless -CreateTunnelIfMissing is used.' }
    $admin = [Environment]::GetEnvironmentVariable('OPENAI_ADMIN_KEY','User')
    if ([string]::IsNullOrWhiteSpace($admin)) { $admin=$env:OPENAI_ADMIN_KEY }
    if ([string]::IsNullOrWhiteSpace($admin)) { throw 'OPENAI_ADMIN_KEY is required to create a tunnel automatically.' }
    if ([string]::IsNullOrWhiteSpace($WorkspaceId) -and [string]::IsNullOrWhiteSpace($OrganizationId)) { throw 'WorkspaceId or OrganizationId is required to create a tunnel.' }
    $args=@('admin','tunnels','create','--name',$TunnelName,'--description','Read-only EVAVO Android USB/ADB/device/app-health observer.','--json')
    if($WorkspaceId){$args+=@('--workspace-id',$WorkspaceId)}
    if($OrganizationId){$args+=@('--organization-id',$OrganizationId)}
    $raw=& $TunnelExe @args 2>&1|Out-String
    if($LASTEXITCODE -ne 0){throw 'OpenAI tunnel creation failed.'}
    try{$doc=$raw.Trim()|ConvertFrom-Json -ErrorAction Stop}catch{throw 'Tunnel creation returned invalid JSON.'}
    $candidate=''
    if($doc.PSObject.Properties.Name -contains 'tunnel_id'){$candidate=[string]$doc.tunnel_id}
    elseif($doc.PSObject.Properties.Name -contains 'id'){$candidate=[string]$doc.id}
    if($candidate -notmatch '^tunnel_[0-9a-f]{32}$'){throw 'Tunnel creation did not return a valid tunnel id.'}
    $TunnelId=$candidate;$created=$true
    [Environment]::SetEnvironmentVariable('CONTROL_PLANE_TUNNEL_ID',$TunnelId,'User')
    [Environment]::SetEnvironmentVariable('CONTROL_PLANE_TUNNEL_ID',$TunnelId,'Process')
}
if($TunnelId -notmatch '^tunnel_[0-9a-f]{32}$'){throw 'TunnelId must match tunnel_<32 lowercase hex>.'}

# Keep secret values in environment references; never write them into repository files or receipts.
if(-not [Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','User') -and $env:CONTROL_PLANE_API_KEY){[Environment]::SetEnvironmentVariable('CONTROL_PLANE_API_KEY',$env:CONTROL_PLANE_API_KEY,'User')}

$mcpCommand=('"{0}" "{1}"' -f $NodeExe,$Observer)
$initRaw=& $TunnelExe init --sample sample_mcp_stdio_local --profile $Profile --tunnel-id $TunnelId --mcp-command $mcpCommand 2>&1|Out-String
if($LASTEXITCODE -ne 0){throw 'tunnel-client failed to initialise the EVAVO Android observer profile.'}
$doctorRaw=& $TunnelExe doctor --profile $Profile --explain 2>&1|Out-String
if($LASTEXITCODE -ne 0){throw 'tunnel-client doctor rejected the EVAVO Android observer profile.'}

$RuntimeRoot=Join-Path $env:LOCALAPPDATA 'EVAVO\AgentInfrastructure\android-observer-tunnel'
New-Item -ItemType Directory -Path $RuntimeRoot -Force|Out-Null
$Launcher=Join-Path $RuntimeRoot 'run-android-observer-tunnel-hidden.vbs'
$TaskArguments="run --profile $Profile"
$Payload=('"{0}" {1}' -f $TunnelExe,$TaskArguments)
$Escaped=$Payload.Replace('"','""')
$LauncherBody=@(
    'Option Explicit',
    'Dim shell, exitCode',
    'Set shell = CreateObject("WScript.Shell")',
    ('exitCode = shell.Run("{0}", 0, True)' -f $Escaped),
    'WScript.Quit exitCode'
)-join"`r`n"
$LauncherBody+="`r`n"
[IO.File]::WriteAllText($Launcher,$LauncherBody,[Text.UTF8Encoding]::new($false))
$LauncherItem=Get-Item -LiteralPath $Launcher -Force -ErrorAction Stop
if($LauncherItem.PSIsContainer-or(($LauncherItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0)){throw 'EVAVO_ANDROID_OBSERVER_LAUNCHER_UNSAFE'}
$LauncherHash=(Get-FileHash -LiteralPath $Launcher -Algorithm SHA256).Hash.ToLowerInvariant()
$WScriptArguments=('//B //NoLogo "{0}"' -f $Launcher)

$Identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if([string]$Identity.User.Value -eq 'S-1-5-18'){throw 'Android observer tunnel must run in the intended interactive user context, not LocalSystem.'}
$UserId=[string]$Identity.Name
$Principal=New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited
$Logon=New-ScheduledTaskTrigger -AtLogOn -User $UserId
$Settings=New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval ([TimeSpan]::FromMinutes(1)) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$TaskName='EVAVO ChatGPT Android Observer Tunnel'
$Action=New-ScheduledTaskAction -Execute $WScript -Argument $WScriptArguments -WorkingDirectory $RuntimeRoot
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Logon -Principal $Principal -Settings $Settings -Description 'Outbound-only OpenAI Secure MCP Tunnel runtime for the read-only EVAVO Android observer MCP. Windowless scheduled host.' -Force|Out-Null
Enable-ScheduledTask -TaskName $TaskName -ErrorAction Stop|Out-Null
$Task=Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop;$Actions=@($Task.Actions)
$exact=[bool](
    [string]$Task.State -ne 'Disabled' -and
    [string]$Task.Principal.UserId -eq $UserId -and
    [string]$Task.Principal.RunLevel -eq 'Limited' -and
    $Actions.Count -eq 1 -and
    [IO.Path]::GetFullPath([string]$Actions[0].Execute) -eq [IO.Path]::GetFullPath($WScript) -and
    [string]$Actions[0].Arguments -eq $WScriptArguments -and
    [IO.Path]::GetFullPath([string]$Actions[0].WorkingDirectory) -eq [IO.Path]::GetFullPath($RuntimeRoot) -and
    (Get-FileHash -LiteralPath $Launcher -Algorithm SHA256).Hash.ToLowerInvariant() -eq $LauncherHash
)
if(-not$exact){Disable-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue|Out-Null;throw 'Android observer tunnel scheduled task failed exact verification.'}
$started=$false
if($StartNow){Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop;$started=$true}

[ordered]@{
    schemaVersion=2
    kind='evavo-chatgpt-android-observer-tunnel-installation-v2'
    ok=$true
    tunnelIdReturned=$false
    tunnelCreated=$created
    profile=$Profile
    scheduledTaskExact=$true
    scheduledTaskHost='wscript.exe'
    consoleFreeScheduledAction=$true
    directTunnelClientScheduledHost=$false
    scheduledTaskWaitsForTunnelExit=$true
    mcpCommandUsesDirectNode=$true
    limitedInteractiveUser=$true
    startAtLogon=$true
    started=$started
    outboundHttpsOnly=$true
    localMcpPublicListenerRequired=$false
    observerReadOnly=$true
    observerMutationAuthority=$false
    effectfulAndroidToolsExposed=$false
    rawAdbSerialReturned=$false
    runtimeApiKeyReturned=$false
    adminKeyReturned=$false
    focusStealAllowed=$false
    chatGptConnectorRegistrationPerformed=$false
    chatGptProductSideConnectorSetupStillRequired=$true
    proWriteActionsClaimed=$false
}|ConvertTo-Json -Depth 10
