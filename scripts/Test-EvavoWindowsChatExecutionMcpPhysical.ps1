[CmdletBinding()]
param([ValidateRange(30,300)][int]$TimeoutSeconds = 120)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Runtime = Join-Path $Root 'mcp-server\windows-chat-execution-mcp.mjs'
$Node = (Get-Command node.exe,node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $Node) { throw 'Node.js is required.' }
if (-not (Test-Path -LiteralPath $Runtime -PathType Leaf)) { throw 'Windows chat execution MCP runtime is missing.' }

$Input = [IO.Path]::GetTempFileName()
$Output = [IO.Path]::GetTempFileName()
$ErrorFile = [IO.Path]::GetTempFileName()
$PreviousEnabled = $env:EVAVO_WINDOWS_CHAT_EXECUTION_ENABLED
$PreviousRecover = $env:EVAVO_WINDOWS_CHAT_EXECUTION_AUTO_RECOVER
try {
    $env:EVAVO_WINDOWS_CHAT_EXECUTION_ENABLED = 'enabled'
    $env:EVAVO_WINDOWS_CHAT_EXECUTION_AUTO_RECOVER = 'enabled'
    $Requests = New-Object Collections.Generic.List[string]
    $Requests.Add((([ordered]@{jsonrpc='2.0';id=1;method='initialize';params=[ordered]@{protocolVersion='2024-11-05';capabilities=@{};clientInfo=[ordered]@{name='evavo-windows-chat-physical';version='1.0.0'}}}|ConvertTo-Json -Compress -Depth 10)))
    $Requests.Add((([ordered]@{jsonrpc='2.0';method='notifications/initialized'}|ConvertTo-Json -Compress -Depth 10)))
    $Requests.Add((([ordered]@{jsonrpc='2.0';id=2;method='tools/call';params=[ordered]@{name='evavo_windows_execution_doctor';arguments=@{}}}|ConvertTo-Json -Compress -Depth 10)))
    $Cases = @(
        @{ Id=3; Shell='powershell'; Command="Write-Output 'evavo-powershell-ok'"; Token='evavo-powershell-ok' },
        @{ Id=4; Shell='python'; Command="print('evavo-python-ok')"; Token='evavo-python-ok' },
        @{ Id=5; Shell='cmd'; Command='echo evavo-cmd-ok'; Token='evavo-cmd-ok' },
        @{ Id=6; Shell='bash'; Command="printf 'evavo-bash-ok\\n'"; Token='evavo-bash-ok' }
    )
    foreach ($Case in $Cases) {
        $Requests.Add((([ordered]@{jsonrpc='2.0';id=$Case.Id;method='tools/call';params=[ordered]@{name='evavo_windows_execute';arguments=[ordered]@{shell=$Case.Shell;command=$Case.Command;cwd='C:\GitRepos';timeoutSeconds=30}}}|ConvertTo-Json -Compress -Depth 12)))
    }
    [IO.File]::WriteAllText($Input,(($Requests -join [Environment]::NewLine)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
    $Process = Start-Process -FilePath $Node -ArgumentList ('"'+$Runtime+'"') -NoNewWindow -PassThru -RedirectStandardInput $Input -RedirectStandardOutput $Output -RedirectStandardError $ErrorFile
    if (-not $Process.WaitForExit($TimeoutSeconds*1000)) { try { & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null } catch {}; throw 'Windows chat execution MCP physical acceptance timed out.' }
    if ($Process.ExitCode -ne 0) { throw "Windows chat execution MCP physical acceptance exited $($Process.ExitCode)." }
    $stderr = Get-Content -LiteralPath $ErrorFile -Raw -Encoding UTF8
    if (-not [string]::IsNullOrWhiteSpace($stderr)) { throw "Windows chat execution MCP wrote unexpected stderr: $stderr" }
    $Responses = @(Get-Content -LiteralPath $Output -Encoding UTF8 | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json -ErrorAction Stop })
    $Doctor = $Responses | Where-Object {$_.id -eq 2} | Select-Object -First 1
    if ($Doctor.result.isError -eq $true) { throw 'Windows chat execution doctor failed.' }
    $DoctorValue = $Doctor.result.structuredContent
    if ($DoctorValue.ok -ne $true -or $DoctorValue.acceptedSourceAttested -ne $true -or [int]$DoctorValue.executorApiRevision -lt 2) { throw 'Windows chat execution doctor did not prove accepted runtime readiness.' }
    $Results = @()
    foreach ($Case in $Cases) {
        $Response = $Responses | Where-Object {$_.id -eq $Case.Id} | Select-Object -First 1
        if ($null -eq $Response -or $Response.result.isError -eq $true) { throw "$($Case.Shell) chat execution probe failed." }
        $Value = $Response.result.structuredContent
        if ($Value.ok -ne $true -or [int]$Value.exitCode -ne 0 -or [string]$Value.stdout -notmatch [regex]::Escape($Case.Token)) { throw "$($Case.Shell) chat execution receipt did not contain expected success proof." }
        if ($Value.arbitraryCommandTextAccepted -ne $true -or $Value.currentWindowsUserAuthority -ne $true -or $Value.acceptedSourceAttested -ne $true -or $Value.loopbackOnly -ne $true) { throw "$($Case.Shell) chat execution authority receipt is incomplete." }
        $Results += [ordered]@{shell=$Case.Shell;ok=$true;exitCode=[int]$Value.exitCode;commandTextReturned=[bool]$Value.commandTextReturned}
    }

    [ordered]@{
        schemaVersion=1
        kind='evavo-windows-chat-execution-physical-acceptance-v1'
        ok=$true
        acceptedSourceAttested=$true
        executorVersion=[string]$DoctorValue.executorVersion
        executorApiRevision=[int]$DoctorValue.executorApiRevision
        runtimeRecovered=[bool]$DoctorValue.runtimeRecovered
        powershellPassed=$true
        pythonPassed=$true
        cmdPassed=$true
        bashPassed=$true
        results=$Results
        currentWindowsUserAuthority=$true
        arbitraryCommandTextAccepted=$true
        commandTextPersistedByMcp=$false
    } | ConvertTo-Json -Depth 10
}
finally {
    if ($null -eq $PreviousEnabled) { Remove-Item Env:EVAVO_WINDOWS_CHAT_EXECUTION_ENABLED -ErrorAction SilentlyContinue } else { $env:EVAVO_WINDOWS_CHAT_EXECUTION_ENABLED = $PreviousEnabled }
    if ($null -eq $PreviousRecover) { Remove-Item Env:EVAVO_WINDOWS_CHAT_EXECUTION_AUTO_RECOVER -ErrorAction SilentlyContinue } else { $env:EVAVO_WINDOWS_CHAT_EXECUTION_AUTO_RECOVER = $PreviousRecover }
    Remove-Item -LiteralPath $Input,$Output,$ErrorFile -Force -ErrorAction SilentlyContinue
}
