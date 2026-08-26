[CmdletBinding()]
param([switch]$ProbeTunnelDoctor)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($env:OS-ne'Windows_NT'){throw'EVAVO_WINDOWS_EXECUTION_STATUS_WINDOWS_REQUIRED'}
if(-not$env:LOCALAPPDATA){throw'EVAVO_WINDOWS_EXECUTION_STATUS_LOCALAPPDATA_REQUIRED'}

$Base=Join-Path $env:LOCALAPPDATA 'EVAVO\WorkerControlPlane\chatgpt-windows-execution'
$TaskName='EVAVO ChatGPT Windows Execution Tunnel'
$Task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$Info=if($Task){Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue}else{$null}
$Manifest=$null;$ManifestPath=$null;$BundleIntegrity=$false
if(Test-Path -LiteralPath (Join-Path $Base 'bundles') -PathType Container){
    $Candidates=@(Get-ChildItem -LiteralPath (Join-Path $Base 'bundles') -Directory -ErrorAction SilentlyContinue|Sort-Object LastWriteTimeUtc -Descending)
    foreach($Candidate in $Candidates){
        $Path=Join-Path $Candidate.FullName 'manifest.json'
        if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){continue}
        try{
            $Doc=Get-Content -LiteralPath $Path -Raw -Encoding UTF8|ConvertFrom-Json -ErrorAction Stop
            if([int]$Doc.schemaVersion-ne1-or[string]$Doc.kind-ne'evavo-chatgpt-windows-execution-bundle-v1'){continue}
            $Mcp=Join-Path $Candidate.FullName 'windows-chat-execution-mcp.mjs';$Launcher=Join-Path $Candidate.FullName 'run-windows-chat-execution-mcp.ps1'
            if(-not(Test-Path -LiteralPath $Mcp -PathType Leaf)-or-not(Test-Path -LiteralPath $Launcher -PathType Leaf)){continue}
            $McpSha=(Get-FileHash -LiteralPath $Mcp -Algorithm SHA256).Hash.ToLowerInvariant();$LauncherSha=(Get-FileHash -LiteralPath $Launcher -Algorithm SHA256).Hash.ToLowerInvariant()
            $BundleIntegrity=[bool]($McpSha-eq([string]$Doc.mcpSha256).ToLowerInvariant()-and$LauncherSha-eq([string]$Doc.launcherSha256).ToLowerInvariant())
            if($BundleIntegrity){$Manifest=$Doc;$ManifestPath=$Path;break}
        }catch{}
    }
}

$TaskExact=$false
if($Task-and$ManifestPath){
    $Bundle=Split-Path -Parent $ManifestPath;$Actions=@($Task.Actions)
    $TaskExact=[bool]([string]$Task.State-ne'Disabled'-and[string]$Task.Principal.RunLevel-eq'Limited'-and$Actions.Count-eq1-and[string]$Actions[0].Arguments-match'^run --profile evavo-windows-execution$'-and[IO.Path]::GetFullPath([string]$Actions[0].WorkingDirectory)-eq[IO.Path]::GetFullPath($Bundle))
}
$Doctor=$null;$DoctorPassed=$false
if($ProbeTunnelDoctor){
    $Tunnel=Get-Command tunnel-client.exe,tunnel-client -CommandType Application -ErrorAction SilentlyContinue|Select-Object -First 1
    if($Tunnel){
        $Previous=$ErrorActionPreference
        try{$ErrorActionPreference='Continue';$Raw=(& $Tunnel.Source doctor --profile evavo-windows-execution --explain 2>&1|Out-String).Trim();$Code=[int]$LASTEXITCODE}finally{$ErrorActionPreference=$Previous}
        $Doctor=[ordered]@{exitCode=$Code;outputSha256=if($Raw){$A=[Security.Cryptography.SHA256]::Create();try{$B=[Text.Encoding]::UTF8.GetBytes($Raw);(($A.ComputeHash($B)|ForEach-Object{$_.ToString('x2')})-join'')}finally{$A.Dispose()}}else{$null}}
        $DoctorPassed=[bool]($Code-eq0)
    }
}

[ordered]@{
    schemaVersion=1
    kind='evavo-chatgpt-windows-execution-tunnel-status-v1'
    ok=$true
    bundlePresent=[bool]$Manifest
    bundleIntegrity=$BundleIntegrity
    repositoryIndependent=if($Manifest){[bool]$Manifest.repositoryIndependent}else{$false}
    effectful=if($Manifest){[bool]$Manifest.effectful}else{$false}
    arbitraryCommandTextAccepted=if($Manifest){[bool]$Manifest.arbitraryCommandTextAccepted}else{$false}
    currentWindowsUserAuthority=if($Manifest){[bool]$Manifest.currentWindowsUserAuthority}else{$false}
    supportedShells=if($Manifest){@($Manifest.supportedShells)}else{@()}
    maximumInteractiveSeconds=if($Manifest){[int]$Manifest.maximumInteractiveSeconds}else{$null}
    acceptedRestExecutorAttestationRequired=if($Manifest){[bool]$Manifest.acceptedRestExecutorAttestationRequired}else{$false}
    taskInstalled=[bool]$Task
    taskState=if($Task){[string]$Task.State}else{'not-installed'}
    taskExact=$TaskExact
    lastTaskResult=if($Info){[int64]$Info.LastTaskResult}else{$null}
    lastRunTime=if($Info){$Info.LastRunTime}else{$null}
    nextRunTime=if($Info){$Info.NextRunTime}else{$null}
    tunnelDoctorProbed=[bool]$ProbeTunnelDoctor
    tunnelDoctorPassed=$DoctorPassed
    tunnelDoctor=$Doctor
    executionReadyByInstalledState=[bool]($BundleIntegrity-and$TaskExact)
    executionReadyByTunnelDoctor=if($ProbeTunnelDoctor){$DoctorPassed}else{$null}
    credentialsReturned=$false
    tunnelIdReturned=$false
    physicalPathsReturned=$false
}|ConvertTo-Json -Depth 10
