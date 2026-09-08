[CmdletBinding()]
param(
    [string]$Profile='evavo-windows-execution',
    [string]$TaskName='EVAVO ChatGPT Windows Execution Compatibility Tunnel',
    [switch]$ProbeTunnelDoctor
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($env:OS-ne'Windows_NT'){throw'EVAVO_WINDOWS_EXECUTION_STATUS_WINDOWS_REQUIRED'}
if(-not$env:LOCALAPPDATA){throw'EVAVO_WINDOWS_EXECUTION_STATUS_LOCALAPPDATA_REQUIRED'}

$Base=Join-Path $env:LOCALAPPDATA 'EVAVO\WorkerControlPlane\chatgpt-windows-execution-compatibility'
$Tunnel=Get-Command tunnel-client.exe,tunnel-client -CommandType Application -ErrorAction SilentlyContinue|Select-Object -First 1
$WScript=Join-Path $env:SystemRoot 'System32\wscript.exe'
$WScriptAvailable=Test-Path -LiteralPath $WScript -PathType Leaf
$Task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$Info=if($Task){Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue}else{$null}
$TunnelId=[Environment]::GetEnvironmentVariable('EVAVO_WINDOWS_EXECUTION_TUNNEL_ID','User')
if([string]::IsNullOrWhiteSpace($TunnelId)){$TunnelId=[string]$env:EVAVO_WINDOWS_EXECUTION_TUNNEL_ID}
$TunnelIdConfigured=[bool]($TunnelId-match'^tunnel_[0-9a-f]{32}$')

$Manifest=$null;$ManifestPath=$null;$BundleIntegrity=$false;$Bundle=$null;$TaskLauncher=$null;$TaskLauncherHashValid=$false
$Bundles=Join-Path $Base 'bundles'
if(Test-Path -LiteralPath $Bundles -PathType Container){
    foreach($Candidate in @(Get-ChildItem -LiteralPath $Bundles -Directory -Force -ErrorAction SilentlyContinue|Sort-Object LastWriteTimeUtc -Descending)){
        if($Candidate.Name-notmatch'^[a-f0-9]{64}$'){continue}
        $Path=Join-Path $Candidate.FullName 'manifest.json'
        $Mcp=Join-Path $Candidate.FullName 'windows-chat-execution-mcp.mjs'
        $LegacyLauncher=Join-Path $Candidate.FullName 'run-windows-chat-execution-compatibility-mcp.ps1'
        $CandidateTaskLauncher=Join-Path $Candidate.FullName 'run-windows-execution-tunnel-hidden.vbs'
        if(-not(Test-Path -LiteralPath $Path -PathType Leaf)-or-not(Test-Path -LiteralPath $Mcp -PathType Leaf)-or-not(Test-Path -LiteralPath $LegacyLauncher -PathType Leaf)-or-not(Test-Path -LiteralPath $CandidateTaskLauncher -PathType Leaf)){continue}
        try{
            $Doc=Get-Content -LiteralPath $Path -Raw -Encoding UTF8|ConvertFrom-Json -ErrorAction Stop
            if([int]$Doc.schemaVersion-ne2-or[string]$Doc.kind-ne'evavo-chatgpt-windows-execution-compatibility-bundle-v2'){continue}
            $McpSha=(Get-FileHash -LiteralPath $Mcp -Algorithm SHA256).Hash.ToLowerInvariant()
            $LegacySha=(Get-FileHash -LiteralPath $LegacyLauncher -Algorithm SHA256).Hash.ToLowerInvariant()
            $TaskLauncherSha=(Get-FileHash -LiteralPath $CandidateTaskLauncher -Algorithm SHA256).Hash.ToLowerInvariant()
            $LauncherItem=Get-Item -LiteralPath $CandidateTaskLauncher -Force -ErrorAction Stop
            $TaskLauncherSafe=[bool](-not$LauncherItem.PSIsContainer-and(($LauncherItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-eq0))
            $BundleIntegrity=[bool](
                $McpSha-eq([string]$Doc.mcpSha256).ToLowerInvariant()-and
                $LegacySha-eq([string]$Doc.launcherSha256).ToLowerInvariant()-and
                $TaskLauncherSha-eq([string]$Doc.taskLauncherSha256).ToLowerInvariant()-and
                $TaskLauncherSafe-and
                $Doc.repositoryIndependent-eq$true-and
                $Doc.compatibilityShim-eq$true-and
                $Doc.effectful-eq$false-and
                $Doc.rawShellExecutionRemoved-eq$true-and
                $Doc.arbitraryCommandTextAccepted-eq$false-and
                $Doc.inlineCodeAccepted-eq$false-and
                $Doc.currentWindowsUserRawShellAuthorityExposed-eq$false-and
                $Doc.mcpCommandUsesDirectNode-eq$true-and
                $Doc.legacyPowerShellLauncherAuthoritative-eq$false-and
                [string]$Doc.scheduledTaskHost-eq'wscript.exe'-and
                $Doc.scheduledTaskWaitsForTunnelExit-eq$true-and
                $Doc.directTunnelClientScheduledHost-eq$false
            )
            if($BundleIntegrity){$Manifest=$Doc;$ManifestPath=$Path;$Bundle=$Candidate.FullName;$TaskLauncher=$CandidateTaskLauncher;$TaskLauncherHashValid=$true;break}
        }catch{}
    }
}

$TaskExact=$false;$TaskConsoleFree=$false;$DirectTunnelClientScheduledHost=$false
if($Task){
    $Actions=@($Task.Actions)
    if($Actions.Count-eq1){
        $ObservedExecute=[IO.Path]::GetFullPath([string]$Actions[0].Execute)
        $DirectTunnelClientScheduledHost=[bool]($Tunnel-and$ObservedExecute-eq[IO.Path]::GetFullPath([string]$Tunnel.Source))
        if($WScriptAvailable-and$TaskLauncher-and$Bundle){
            $ExpectedArguments=('//B //NoLogo "{0}"' -f $TaskLauncher)
            $TaskExact=[bool](
                [string]$Task.State-ne'Disabled'-and
                [string]$Task.Principal.RunLevel-eq'Limited'-and
                $ObservedExecute-eq[IO.Path]::GetFullPath($WScript)-and
                [string]$Actions[0].Arguments-eq$ExpectedArguments-and
                [IO.Path]::GetFullPath([string]$Actions[0].WorkingDirectory)-eq[IO.Path]::GetFullPath($Bundle)-and
                $TaskLauncherHashValid
            )
            $TaskConsoleFree=$TaskExact
        }
    }
}

$Doctor=$null;$DoctorPassed=$false
if($ProbeTunnelDoctor-and$Tunnel-and$TunnelIdConfigured){
    $Previous=$ErrorActionPreference
    try{$ErrorActionPreference='Continue';$Raw=(& $Tunnel.Source doctor --profile $Profile --explain 2>&1|Out-String).Trim();$Code=[int]$LASTEXITCODE}finally{$ErrorActionPreference=$Previous}
    $Doctor=[ordered]@{exitCode=$Code;outputSha256=if($Raw){$A=[Security.Cryptography.SHA256]::Create();try{$B=[Text.Encoding]::UTF8.GetBytes($Raw);(($A.ComputeHash($B)|ForEach-Object{$_.ToString('x2')})-join'')}finally{$A.Dispose()}}else{$null}}
    $DoctorPassed=[bool]($Code-eq0)
}

$InstalledReady=[bool]($Tunnel-and$TunnelIdConfigured-and$BundleIntegrity-and$TaskExact)
# A requested runtime probe is authoritative. Installed/configured state alone must
# never keep the top-level status green after the tunnel doctor has failed.
$RuntimeReady=[bool]($InstalledReady-and(-not$ProbeTunnelDoctor-or$DoctorPassed))

[ordered]@{
    schemaVersion=3
    kind='evavo-chatgpt-windows-execution-tunnel-status-v3'
    ok=$RuntimeReady
    checkedAt=[DateTimeOffset]::UtcNow.ToString('o')
    profile=$Profile
    bundlePresent=[bool]$Manifest
    bundleIntegrity=$BundleIntegrity
    repositoryIndependent=if($Manifest){[bool]$Manifest.repositoryIndependent}else{$false}
    compatibilityShim=if($Manifest){[bool]$Manifest.compatibilityShim}else{$false}
    effectful=$false
    rawShellExecutionRemoved=if($Manifest){[bool]$Manifest.rawShellExecutionRemoved}else{$false}
    arbitraryCommandTextAccepted=$false
    inlineCodeAccepted=$false
    currentWindowsUserRawShellAuthorityExposed=$false
    mcpCommandUsesDirectNode=if($Manifest){[bool]$Manifest.mcpCommandUsesDirectNode}else{$false}
    legacyPowerShellMcpLauncherAuthoritative=if($Manifest){[bool]$Manifest.legacyPowerShellLauncherAuthoritative}else{$false}
    tunnelClientAvailable=[bool]$Tunnel
    tunnelIdConfigured=$TunnelIdConfigured
    taskInstalled=[bool]$Task
    taskState=if($Task){[string]$Task.State}else{'not-installed'}
    taskExact=$TaskExact
    scheduledTaskHost=if($TaskConsoleFree){'wscript.exe'}else{$null}
    consoleFreeScheduledAction=$TaskConsoleFree
    directTunnelClientScheduledHost=$DirectTunnelClientScheduledHost
    scheduledTaskWaitsForTunnelExit=$TaskConsoleFree
    lastTaskResult=if($Info){[int64]$Info.LastTaskResult}else{$null}
    lastRunTime=if($Info-and$Info.LastRunTime-gt[DateTime]::MinValue){$Info.LastRunTime.ToUniversalTime().ToString('o')}else{$null}
    nextRunTime=if($Info-and$Info.NextRunTime-gt[DateTime]::MinValue){$Info.NextRunTime.ToUniversalTime().ToString('o')}else{$null}
    tunnelDoctorProbed=[bool]$ProbeTunnelDoctor
    tunnelDoctorPassed=$DoctorPassed
    tunnelDoctor=$Doctor
    executionReadyByInstalledState=$InstalledReady
    executionReadyByTunnelDoctor=if($ProbeTunnelDoctor){$DoctorPassed}else{$null}
    runtimeReadinessProbed=[bool]$ProbeTunnelDoctor
    runtimeReady=$RuntimeReady
    readinessBasis=if($ProbeTunnelDoctor){'installed-state-and-tunnel-doctor'}else{'installed-state-only'}
    focusStealAllowed=$false
    credentialsReturned=$false
    tunnelIdReturned=$false
    physicalPathsReturned=$false
}|ConvertTo-Json -Depth 10
