[CmdletBinding()]
param([ValidateRange(5,60)][int]$TimeoutSeconds = 20)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Runtime = Join-Path $Root 'mcp-server\windows-chat-execution-mcp.mjs'
$Node = (Get-Command node.exe,node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $Node) { throw 'Node.js is required.' }
if (-not (Test-Path -LiteralPath $Runtime -PathType Leaf)) { throw 'Windows chat execution compatibility MCP runtime is missing.' }

$Input = [IO.Path]::GetTempFileName()
$Output = [IO.Path]::GetTempFileName()
$ErrorFile = [IO.Path]::GetTempFileName()
try {
    $Requests = @(
        ([ordered]@{jsonrpc='2.0';id=1;method='initialize';params=[ordered]@{protocolVersion='2024-11-05';capabilities=@{};clientInfo=[ordered]@{name='evavo-windows-chat-handshake';version='2.0.0'}}}|ConvertTo-Json -Compress -Depth 10),
        ([ordered]@{jsonrpc='2.0';method='notifications/initialized'}|ConvertTo-Json -Compress -Depth 10),
        ([ordered]@{jsonrpc='2.0';id=2;method='tools/list'}|ConvertTo-Json -Compress -Depth 10),
        ([ordered]@{jsonrpc='2.0';id=3;method='tools/call';params=[ordered]@{name='evavo_windows_execution_route';arguments=@{}}}|ConvertTo-Json -Compress -Depth 10)
    )
    [IO.File]::WriteAllText($Input,(($Requests -join [Environment]::NewLine)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
    $Process = Start-Process -FilePath $Node -ArgumentList ('"'+$Runtime+'"') -NoNewWindow -PassThru -RedirectStandardInput $Input -RedirectStandardOutput $Output -RedirectStandardError $ErrorFile
    if (-not $Process.WaitForExit($TimeoutSeconds*1000)) { try { & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null } catch {}; throw 'Windows chat execution compatibility MCP handshake timed out.' }
    if ($Process.ExitCode -ne 0) { throw "Windows chat execution compatibility MCP exited $($Process.ExitCode)." }
    $stderr = Get-Content -LiteralPath $ErrorFile -Raw -Encoding UTF8
    if (-not [string]::IsNullOrWhiteSpace($stderr)) { throw "Windows chat execution compatibility MCP wrote unexpected stderr: $stderr" }
    $Responses = @(Get-Content -LiteralPath $Output -Encoding UTF8 | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json -ErrorAction Stop })
    $Init = $Responses | Where-Object {$_.id -eq 1} | Select-Object -First 1
    if ([string]$Init.result.serverInfo.name -ne 'evavo-windows-chat-execution-mcp' -or [string]$Init.result.serverInfo.version -ne '2.1.0') { throw 'Windows chat execution compatibility MCP identity mismatch.' }
    $List = $Responses | Where-Object {$_.id -eq 2} | Select-Object -First 1
    $Tools = @($List.result.tools)
    $Names = @($Tools | ForEach-Object { [string]$_.name })
    foreach ($Required in @('evavo_windows_execution_doctor','evavo_windows_execution_route')) {
        if ($Names -notcontains $Required) { throw "Windows chat execution compatibility MCP missing tool: $Required" }
    }
    foreach ($Forbidden in @('evavo_windows_execute','evavo_windows_execute_batch')) {
        if ($Names -contains $Forbidden) { throw "Retired effectful tool must not be advertised: $Forbidden" }
    }
    foreach ($Tool in $Tools) {
        if ($Tool.annotations.readOnlyHint -ne $true -or $Tool.annotations.destructiveHint -ne $false) { throw "Tool $($Tool.name) must be read-only." }
        if ($Tool._meta.'io.evavo/arbitraryCommandTextAccepted' -eq $true -or $Tool._meta.'io.evavo/inlineCodeAccepted' -eq $true) { throw "Tool $($Tool.name) must not expose raw shell authority." }
    }
    $RouteResponse = $Responses | Where-Object {$_.id -eq 3} | Select-Object -First 1
    $Route = $RouteResponse.result.structuredContent
    if ($Route.legacyRawShellExecutionRemoved -ne $true -or $Route.authority.arbitraryCommandTextAccepted -ne $false -or $Route.authority.inlineCodeAccepted -ne $false) { throw 'Compatibility route authority mismatch.' }

    [ordered]@{
        schemaVersion=2
        kind='evavo-windows-chat-execution-mcp-handshake-v2'
        ok=$true
        server='evavo-windows-chat-execution-mcp'
        version='2.1.0'
        compatibilityShim=$true
        tools=$Names
        rawShellExecutionRemoved=$true
        arbitraryCommandTextAccepted=$false
        inlineCodeAccepted=$false
        currentWindowsUserRawShellAuthorityExposed=$false
        workstationContacted=$false
        commandExecuted=$false
    } | ConvertTo-Json -Depth 8
}
finally {
    Remove-Item -LiteralPath $Input,$Output,$ErrorFile -Force -ErrorAction SilentlyContinue
}
