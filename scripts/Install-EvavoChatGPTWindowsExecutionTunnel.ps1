[CmdletBinding()]
param(
    [string]$Profile = 'evavo-windows-execution',
    [string]$TunnelName = 'EVAVO Windows Execution Compatibility',
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
if ($env:OS -ne 'Windows_NT') { throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_WINDOWS_REQUIRED' }
if (-not $env:LOCALAPPDATA) { throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_LOCALAPPDATA_REQUIRED' }

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$SourceMcp = Join-Path $Root 'mcp-server\windows-chat-execution-mcp.mjs'
$Contract = Join-Path $Root 'scripts\Test-EvavoWindowsChatExecutionMcpContract.ps1'
foreach ($Path in @($SourceMcp,$Contract)) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "EVAVO_WINDOWS_EXECUTION_TUNNEL_SOURCE_MISSING:$Path" }
    $Item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_SOURCE_REPARSE' }
}

$Node = Get-Command node.exe,node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$PowerShell = Get-Command powershell.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
$TunnelClient = Get-Command tunnel-client.exe,tunnel-client -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $TunnelClient) { throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_CLIENT_REQUIRED' }
$NodeExe = [IO.Path]::GetFullPath([string]$Node.Source)
$PowerShellExe = [IO.Path]::GetFullPath([string]$PowerShell.Source)
$TunnelExe = [IO.Path]::GetFullPath([string]$TunnelClient.Source)

$NodeCheck = (& $NodeExe --check $SourceMcp 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "EVAVO_WINDOWS_EXECUTION_TUNNEL_SOURCE_NODE_CHECK_FAILED:$NodeCheck" }
$ContractRaw = (& $PowerShellExe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Contract | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_CONTRACT_FAILED' }
$ContractReceipt = $ContractRaw | ConvertFrom-Json -ErrorAction Stop
if ($ContractReceipt.ok -ne $true -or $ContractReceipt.rawShellExecutionRemoved -ne $true -or $ContractReceipt.arbitraryCommandTextAccepted -ne $false -or $ContractReceipt.inlineCodeAccepted -ne $false) { throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_CONTRACT_NOT_ACCEPTED' }

$RuntimeKey = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','User')
$RuntimeKeySource = 'user-control-plane'
if ([string]::IsNullOrWhiteSpace($RuntimeKey)) { $RuntimeKey=[string]$env:CONTROL_PLANE_API_KEY; $RuntimeKeySource='process-control-plane' }
if ([string]::IsNullOrWhiteSpace($RuntimeKey)) { $RuntimeKey=[Environment]::GetEnvironmentVariable('OPENAI_API_KEY','User'); $RuntimeKeySource='user-openai' }
if ([string]::IsNullOrWhiteSpace($RuntimeKey)) { $RuntimeKey=[string]$env:OPENAI_API_KEY; $RuntimeKeySource='process-openai' }
if ([string]::IsNullOrWhiteSpace($RuntimeKey)) { throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_RUNTIME_KEY_REQUIRED' }
$PersistedRuntimeKey = $false
if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','User'))) {
    [Environment]::SetEnvironmentVariable('CONTROL_PLANE_API_KEY',$RuntimeKey,'User')
    [Environment]::SetEnvironmentVariable('CONTROL_PLANE_API_KEY',$RuntimeKey,'Process')
    $PersistedRuntimeKey = $true
}
if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','User'))) { throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_RUNTIME_KEY_PERSIST_FAILED' }

$SourceSha = (Get-FileHash -LiteralPath $SourceMcp -Algorithm SHA256).Hash.ToLowerInvariant()
$Base = Join-Path $env:LOCALAPPDATA 'EVAVO\WorkerControlPlane\chatgpt-windows-execution-compatibility'
$Bundle = Join-Path (Join-Path $Base 'bundles') $SourceSha
$InstalledMcp = Join-Path $Bundle 'windows-chat-execution-mcp.mjs'
$Launcher = Join-Path $Bundle 'run-windows-chat-execution-compatibility-mcp.ps1'
$ManifestPath = Join-Path $Bundle 'manifest.json'
New-Item -ItemType Directory -Path $Bundle -Force | Out-Null
Copy-Item -LiteralPath $SourceMcp -Destination $InstalledMcp -Force
$InstalledSha = (Get-FileHash -LiteralPath $InstalledMcp -Algorithm SHA256).Hash.ToLowerInvariant()
if ($InstalledSha -ne $SourceSha) { throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_BUNDLE_HASH_MISMATCH' }
$InstalledCheck = (& $NodeExe --check $InstalledMcp 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "EVAVO_WINDOWS_EXECUTION_TUNNEL_BUNDLE_NODE_CHECK_FAILED:$InstalledCheck" }

$LauncherBody = @"
Set-StrictMode -Version Latest
`$ErrorActionPreference='Stop'
& '$($NodeExe.Replace("'","''"))' '$($InstalledMcp.Replace("'","''"))'
exit `$LASTEXITCODE
"@
[IO.File]::WriteAllText($Launcher,$LauncherBody,[Text.UTF8Encoding]::new($false))
$Tokens=$null;$Errors=$null;[Management.Automation.Language.Parser]::ParseFile($Launcher,[ref]$Tokens,[ref]$Errors)|Out-Null
if (@($Errors).Count -gt 0) { throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_LAUNCHER_PARSE_FAILED' }

[IO.File]::WriteAllText($ManifestPath,([ordered]@{
    schemaVersion=2
    kind='evavo-chatgpt-windows-execution-compatibility-bundle-v2'
    installedAt=[DateTimeOffset]::UtcNow.ToString('o')
    mcpSha256=$InstalledSha
    launcherSha256=(Get-FileHash -LiteralPath $Launcher -Algorithm SHA256).Hash.ToLowerInvariant()
    nodeExecutable=$NodeExe
    repositoryIndependent=$true
    compatibilityShim=$true
    effectful=$false
    rawShellExecutionRemoved=$true
    arbitraryCommandTextAccepted=$false
    inlineCodeAccepted=$false
    currentWindowsUserRawShellAuthorityExposed=$false
    canonicalStructuredExecutor='EVAVO-STUDIO/evavo-local-compute'
    canonicalWorkstationBridge='evavo-windows-workstation-bridge'
    effectfulCloudFallbacks=@('cloudflare-typed-relay','github-issue-queue')
    inboundWorkstationListenerRequired=$false
} | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))

if (-not $TunnelId) {
    $TunnelId = [Environment]::GetEnvironmentVariable('EVAVO_WINDOWS_EXECUTION_TUNNEL_ID','User')
    if ([string]::IsNullOrWhiteSpace($TunnelId)) { $TunnelId=[string]$env:EVAVO_WINDOWS_EXECUTION_TUNNEL_ID }
}
if (-not $WorkspaceId) { $WorkspaceId=[string]$env:OPENAI_WORKSPACE_ID }
if (-not $OrganizationId) { $OrganizationId=[string]$env:OPENAI_ORGANIZATION_ID }
$Created=$false
if ([string]::IsNullOrWhiteSpace($TunnelId)) {
    if (-not $CreateTunnelIfMissing) { throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_ID_REQUIRED' }
    $Admin=[Environment]::GetEnvironmentVariable('OPENAI_ADMIN_KEY','User')
    if ([string]::IsNullOrWhiteSpace($Admin)) { $Admin=[string]$env:OPENAI_ADMIN_KEY }
    if ([string]::IsNullOrWhiteSpace($Admin)) { throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_ADMIN_KEY_REQUIRED' }
    if ([string]::IsNullOrWhiteSpace($WorkspaceId) -and [string]::IsNullOrWhiteSpace($OrganizationId)) { throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_SCOPE_REQUIRED' }
    $Args=@('admin','tunnels','create','--name',$TunnelName,'--description','Read-only EVAVO Windows execution migration/route compatibility MCP. Raw shell execution is retired; use Local Compute typed execution.','--json')
    if ($WorkspaceId) { $Args += @('--workspace-id',$WorkspaceId) }
    if ($OrganizationId) { $Args += @('--organization-id',$OrganizationId) }
    $Raw=(& $TunnelExe @Args 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_CREATE_FAILED' }
    $Doc=$Raw|ConvertFrom-Json -ErrorAction Stop
    $Candidate=if($Doc.PSObject.Properties.Name-contains'tunnel_id'){[string]$Doc.tunnel_id}elseif($Doc.PSObject.Properties.Name-contains'id'){[string]$Doc.id}else{''}
    if ($Candidate -notmatch '^tunnel_[0-9a-f]{32}$') { throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_ID_INVALID' }
    $TunnelId=$Candidate;$Created=$true
    [Environment]::SetEnvironmentVariable('EVAVO_WINDOWS_EXECUTION_TUNNEL_ID',$TunnelId,'User')
    [Environment]::SetEnvironmentVariable('EVAVO_WINDOWS_EXECUTION_TUNNEL_ID',$TunnelId,'Process')
}
if ($TunnelId -notmatch '^tunnel_[0-9a-f]{32}$') { throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_ID_INVALID' }

$McpCommand = "`"$PowerShellExe`" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Launcher`""
$InitRaw = (& $TunnelExe init --sample sample_mcp_stdio_local --profile $Profile --tunnel-id $TunnelId --mcp-command $McpCommand 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "EVAVO_WINDOWS_EXECUTION_TUNNEL_INIT_FAILED:$InitRaw" }
$DoctorRaw = (& $TunnelExe doctor --profile $Profile --explain 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "EVAVO_WINDOWS_EXECUTION_TUNNEL_DOCTOR_FAILED:$DoctorRaw" }

$Identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if ($Identity.IsSystem) { throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_INTERACTIVE_USER_REQUIRED' }
$UserId=[string]$Identity.Name
$TaskName='EVAVO ChatGPT Windows Execution Compatibility Tunnel'
$TaskArguments="run --profile $Profile"
$Principal=New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited
$Logon=New-ScheduledTaskTrigger -AtLogOn -User $UserId
$Periodic=New-ScheduledTaskTrigger -Once -At((Get-Date).AddMinutes(2))-RepetitionInterval(New-TimeSpan -Minutes 15)-RepetitionDuration([TimeSpan]::MaxValue)
$Settings=New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -ExecutionTimeLimit([TimeSpan]::Zero)-MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval([TimeSpan]::FromMinutes(1))-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$Action=New-ScheduledTaskAction -Execute $TunnelExe -Argument $TaskArguments -WorkingDirectory $Bundle
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger @($Logon,$Periodic) -Principal $Principal -Settings $Settings -Description 'Outbound-only read-only OpenAI Secure MCP compatibility tunnel. Effectful Windows execution is owned by Local Compute typed routes.' -Force|Out-Null
Enable-ScheduledTask -TaskName $TaskName -ErrorAction Stop|Out-Null
$Task=Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$Actions=@($Task.Actions)
$Exact=[bool]([string]$Task.State-ne'Disabled'-and[string]$Task.Principal.UserId-eq$UserId-and[string]$Task.Principal.RunLevel-eq'Limited'-and$Actions.Count-eq1-and[IO.Path]::GetFullPath([string]$Actions[0].Execute)-eq$TunnelExe-and[string]$Actions[0].Arguments-eq$TaskArguments-and[IO.Path]::GetFullPath([string]$Actions[0].WorkingDirectory)-eq[IO.Path]::GetFullPath($Bundle))
if (-not $Exact) { Disable-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue|Out-Null; throw 'EVAVO_WINDOWS_EXECUTION_TUNNEL_TASK_INVALID' }
$Started=$false
if ($StartNow) { Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop; $Started=$true }

[ordered]@{
    schemaVersion=2
    kind='evavo-chatgpt-windows-execution-tunnel-installation-v2'
    ok=$true
    tunnelCreated=$Created
    tunnelIdReturned=$false
    profile=$Profile
    mcpSha256=$InstalledSha
    immutableBundle=$true
    repositoryIndependent=$true
    compatibilityShim=$true
    scheduledTaskExact=$true
    limitedInteractiveUser=$true
    startAtLogon=$true
    periodicRecoveryMinutes=15
    started=$Started
    outboundOnly=$true
    localPublicListenerRequired=$false
    effectfulWorkstationToolsExposed=$false
    rawShellExecutionRemoved=$true
    arbitraryCommandTextAccepted=$false
    inlineCodeAccepted=$false
    currentWindowsUserRawShellAuthorityExposed=$false
    canonicalStructuredExecutor='EVAVO-STUDIO/evavo-local-compute'
    canonicalWorkstationBridge='evavo-windows-workstation-bridge'
    effectfulCloudFallbacks=@('cloudflare-typed-relay','github-issue-queue')
    runtimeCredentialPersistedForBackgroundTask=$true
    runtimeCredentialPersistedThisRun=$PersistedRuntimeKey
    runtimeCredentialSourceCategory=$RuntimeKeySource
    runtimeCredentialValueReturned=$false
    adminKeyReturned=$false
    tunnelIdValueReturned=$false
    chatGptConnectorRegistrationPerformed=$false
    chatGptProductSideConnectorSetupStillRequired=$true
} | ConvertTo-Json -Depth 10

$RuntimeKey=$null
