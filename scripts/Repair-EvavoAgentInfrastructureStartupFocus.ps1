[CmdletBinding()]
param(
    [switch]$StartNow,
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ($env:OS -ne 'Windows_NT') { throw 'EVAVO_AGENT_INFRA_FOCUS_WINDOWS_REQUIRED' }
if (-not $env:LOCALAPPDATA) { throw 'EVAVO_AGENT_INFRA_FOCUS_LOCALAPPDATA_REQUIRED' }

$WScript = Join-Path $env:SystemRoot 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $WScript -PathType Leaf)) { throw 'EVAVO_AGENT_INFRA_FOCUS_WSCRIPT_REQUIRED' }
$Root = Join-Path $env:LOCALAPPDATA 'EVAVO\AgentInfrastructure\console-free-tasks'
New-Item -ItemType Directory -Path $Root -Force | Out-Null

$OwnedTaskNames = @(
    'EVAVO ChatGPT Windows Execution Compatibility Tunnel',
    'EVAVO ChatGPT Workstation Observer Tunnel',
    'EVAVO ChatGPT Android Observer Tunnel'
)

function Test-ConsoleLikeHost([string]$Executable) {
    if ([string]::IsNullOrWhiteSpace($Executable)) { return $false }
    $Name = [IO.Path]::GetFileName($Executable)
    return [bool]($Name -match '(?i)^(?:powershell|pwsh|cmd|python|py|node|tunnel-client)\.exe$')
}
function Get-LauncherPath([string]$TaskName) {
    $Safe = (($TaskName -replace '[^A-Za-z0-9._-]','-').Trim('-'))
    return Join-Path $Root ($Safe + '.vbs')
}
function Get-WScriptLauncherPath([string]$Arguments) {
    if ([string]::IsNullOrWhiteSpace($Arguments)) { return $null }
    $Match = [regex]::Match($Arguments,'(?i)^//B\s+//NoLogo\s+"(?<path>[^"]+\.vbs)"$')
    if (-not $Match.Success) { return $null }
    try { return [IO.Path]::GetFullPath([string]$Match.Groups['path'].Value) } catch { return $null }
}
function Test-WaitingHiddenLauncher([string]$Launcher) {
    if ([string]::IsNullOrWhiteSpace($Launcher) -or -not (Test-Path -LiteralPath $Launcher -PathType Leaf)) { return $false }
    try {
        $Item = Get-Item -LiteralPath $Launcher -Force -ErrorAction Stop
        if ($Item.PSIsContainer -or (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { return $false }
        $Text = [IO.File]::ReadAllText($Launcher,[Text.Encoding]::UTF8)
        return [bool](
            $Text -match '(?im)^Set shell = CreateObject\("WScript\.Shell"\)\s*$' -and
            $Text -match '(?im)^exitCode = shell\.Run\(".+",\s*0,\s*True\)\s*$' -and
            $Text -match '(?im)^WScript\.Quit exitCode\s*$'
        )
    } catch { return $false }
}
function New-HiddenAction($Action,[string]$TaskName) {
    $Execute = [string]$Action.Execute
    $Arguments = [string]$Action.Arguments
    $WorkingDirectory = [string]$Action.WorkingDirectory
    $Payload = '"' + $Execute + '"'
    if (-not [string]::IsNullOrWhiteSpace($Arguments)) { $Payload += ' ' + $Arguments }
    $Escaped = $Payload.Replace('"','""')
    $Launcher = Get-LauncherPath $TaskName
    $Body = @(
        'Option Explicit',
        'Dim shell, exitCode',
        'Set shell = CreateObject("WScript.Shell")',
        ('exitCode = shell.Run("{0}", 0, True)' -f $Escaped),
        'WScript.Quit exitCode'
    ) -join "`r`n"
    $Body += "`r`n"
    [IO.File]::WriteAllText($Launcher,$Body,[Text.UTF8Encoding]::new($false))
    $Observed = [IO.File]::ReadAllText($Launcher,[Text.Encoding]::UTF8)
    if ($Observed -ne $Body) { throw "EVAVO_AGENT_INFRA_FOCUS_LAUNCHER_READBACK_FAILED:$TaskName" }
    if (-not (Test-WaitingHiddenLauncher $Launcher)) { throw "EVAVO_AGENT_INFRA_FOCUS_LAUNCHER_POLICY_FAILED:$TaskName" }
    $VbsArgs = '//B //NoLogo "' + $Launcher + '"'
    if ([string]::IsNullOrWhiteSpace($WorkingDirectory)) {
        return [pscustomobject]@{ action=(New-ScheduledTaskAction -Execute $WScript -Argument $VbsArgs); launcher=$Launcher }
    }
    return [pscustomobject]@{ action=(New-ScheduledTaskAction -Execute $WScript -Argument $VbsArgs -WorkingDirectory $WorkingDirectory); launcher=$Launcher }
}

$Rows = @()
$Failures = @()
foreach ($TaskName in $OwnedTaskNames) {
    $Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $Task) {
        $Rows += [pscustomobject][ordered]@{taskName=$TaskName;present=$false;changed=$false;consoleFree=$true;launcherPolicyValid=$true;state='absent';lastTaskResult=$null;launcher=$null;error=$null}
        continue
    }
    $Info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
    $Actions = @($Task.Actions)
    if ($Actions.Count -ne 1) {
        $ErrorText = 'unexpected_action_count:' + $Actions.Count
        $Failures += [pscustomobject]@{taskName=$TaskName;error=$ErrorText}
        $Rows += [pscustomobject][ordered]@{taskName=$TaskName;present=$true;changed=$false;consoleFree=$false;launcherPolicyValid=$false;state=[string]$Task.State;lastTaskResult=if($Info){$Info.LastTaskResult}else{$null};launcher=$null;error=$ErrorText}
        continue
    }
    $Action = $Actions[0]
    $Changed = $false
    $Launcher = $null
    try {
        if (Test-ConsoleLikeHost ([string]$Action.Execute)) {
            $Hidden = New-HiddenAction $Action $TaskName
            Set-ScheduledTask -TaskName $TaskName -Action $Hidden.action -ErrorAction Stop | Out-Null
            $Changed = $true
            $Launcher = [string]$Hidden.launcher
        }
        $ObservedTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        $ObservedActions = @($ObservedTask.Actions)
        $ObservedLauncher = if ($ObservedActions.Count -eq 1) { Get-WScriptLauncherPath ([string]$ObservedActions[0].Arguments) } else { $null }
        $LauncherPolicyValid = Test-WaitingHiddenLauncher $ObservedLauncher
        $ConsoleFree = [bool](
            $ObservedActions.Count -eq 1 -and
            [IO.Path]::GetFileName([string]$ObservedActions[0].Execute) -ieq 'wscript.exe' -and
            $LauncherPolicyValid
        )
        if (-not $ConsoleFree) { throw 'console_free_action_not_proven' }
        if ($StartNow -and [string]$ObservedTask.State -ne 'Disabled') { Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop }
        $Rows += [pscustomobject][ordered]@{
            taskName=$TaskName
            present=$true
            changed=$Changed
            consoleFree=$ConsoleFree
            launcherPolicyValid=$LauncherPolicyValid
            state=[string]$ObservedTask.State
            lastTaskResult=if($Info){$Info.LastTaskResult}else{$null}
            launcher=if($Launcher){$Launcher}else{$ObservedLauncher}
            error=$null
        }
    }
    catch {
        $ErrorText = $_.Exception.GetType().Name + ':' + $_.Exception.Message
        $Failures += [pscustomobject]@{taskName=$TaskName;error=$ErrorText}
        $Rows += [pscustomobject][ordered]@{taskName=$TaskName;present=$true;changed=$Changed;consoleFree=$false;launcherPolicyValid=$false;state=[string]$Task.State;lastTaskResult=if($Info){$Info.LastTaskResult}else{$null};launcher=$Launcher;error=$ErrorText}
    }
}

$Present = @($Rows | Where-Object present)
$Result = [ordered]@{
    schemaVersion=2
    kind='evavo-agent-infrastructure-startup-focus-repair-v2'
    ok=[bool]($Failures.Count -eq 0 -and @($Present | Where-Object { -not $_.consoleFree }).Count -eq 0)
    completedAt=[DateTimeOffset]::UtcNow.ToString('o')
    ownedTaskNames=$OwnedTaskNames
    tasks=$Rows
    presentTasks=$Present.Count
    changedTasks=@($Rows | Where-Object changed).Count
    failures=$Failures
    ownerScopedMutation=$true
    crossRepositoryTaskMutationAllowed=$false
    allOwnedTunnelTasksCovered=$true
    wscriptHiddenLaunch=$true
    waitingLauncherContentVerified=$true
    childExitCodePropagated=$true
    taskTriggersPreserved=$true
    taskSettingsPreserved=$true
    taskPrincipalPreserved=$true
    startRequested=[bool]$StartNow
    focusStealAllowed=$false
    desktopCommanderRequired=$false
    administratorElevationPerformed=$false
}
if ($Json) { $Result | ConvertTo-Json -Depth 10 -Compress } else { $Result | ConvertTo-Json -Depth 10 }
if (-not $Result.ok) { exit 2 }
exit 0
