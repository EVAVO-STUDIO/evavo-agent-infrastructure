[CmdletBinding()]
param([ValidateRange(5,60)][int]$TimeoutSeconds = 20)

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
try {
    $Requests = @(
        ([ordered]@{jsonrpc='2.0';id=1;method='initialize';params=[ordered]@{protocolVersion='2024-11-05';capabilities=@{};clientInfo=[ordered]@{name='evavo-windows-chat-handshake';version='1.0.0'}}}|ConvertTo-Json -Compress -Depth 10),
        ([ordered]@{jsonrpc='2.0';method='notifications/initialized'}|ConvertTo-Json -Compress -Depth 10),
        ([ordered]@{jsonrpc='2.0';id=2;method='tools/list'}|ConvertTo-Json -Compress -Depth 10)
    )
    [IO.File]::WriteAllText($Input,(($Requests -join [Environment]::NewLine)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
    $Process = Start-Process -FilePath $Node -ArgumentList ('"'+$Runtime+'"') -NoNewWindow -PassThru -RedirectStandardInput $Input -RedirectStandardOutput $Output -RedirectStandardError $ErrorFile
    if (-not $Process.WaitForExit($TimeoutSeconds*1000)) { try { & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null } catch {}; throw 'Windows chat execution MCP handshake timed out.' }
    if ($Process.ExitCode -ne 0) { throw "Windows chat execution MCP exited $($Process.ExitCode)." }
    $stderr = Get-Content -LiteralPath $ErrorFile -Raw -Encoding UTF8
    if (-not [string]::IsNullOrWhiteSpace($stderr)) { throw "Windows chat execution MCP wrote unexpected stderr: $stderr" }
    $Responses = @(Get-Content -LiteralPath $Output -Encoding UTF8 | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json -ErrorAction Stop })
    $Init = $Responses | Where-Object {$_.id -eq 1} | Select-Object -First 1
    if ([string]$Init.result.serverInfo.name -ne 'evavo-windows-chat-execution-mcp' -or [string]$Init.result.serverInfo.version -ne '1.0.0') { throw 'Windows chat execution MCP identity mismatch.' }
    $List = $Responses | Where-Object {$_.id -eq 2} | Select-Object -First 1
    $Tools = @($List.result.tools)
    $Names = @($Tools | ForEach-Object { [string]$_.name })
    foreach ($Required in @('evavo_windows_execution_doctor','evavo_windows_execute','evavo_windows_execute_batch')) {
        if ($Names -notcontains $Required) { throw "Windows chat execution MCP missing tool: $Required" }
    }
    foreach ($Name in @('evavo_windows_execute','evavo_windows_execute_batch')) {
        $Tool = $Tools | Where-Object { $_.name -eq $Name } | Select-Object -First 1
        if ($Tool._meta.'io.evavo/arbitraryCommandTextAccepted' -ne $true -or $Tool._meta.'io.evavo/inlineCodeAccepted' -ne $true -or $Tool._meta.'io.evavo/currentWindowsUserAuthority' -ne $true) { throw "$Name effect metadata is incomplete." }
        if ($Tool.annotations.destructiveHint -ne $true -or $Tool.annotations.openWorldHint -ne $true) { throw "$Name must explicitly advertise effectful/open-world execution." }
    }

    [ordered]@{
        schemaVersion=1
        kind='evavo-windows-chat-execution-mcp-handshake-v1'
        ok=$true
        server='evavo-windows-chat-execution-mcp'
        version='1.0.0'
        tools=$Names
        arbitraryCommandTextAccepted=$true
        inlineCodeAccepted=$true
        currentWindowsUserAuthority=$true
        workstationContacted=$false
        commandExecuted=$false
    } | ConvertTo-Json -Depth 8
}
finally {
    Remove-Item -LiteralPath $Input,$Output,$ErrorFile -Force -ErrorAction SilentlyContinue
}
