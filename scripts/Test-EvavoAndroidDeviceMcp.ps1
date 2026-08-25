[CmdletBinding()]
param(
    [ValidateRange(10,120)][int]$TimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$Runtime = Join-Path $Root 'mcp-server\android-device-mcp.mjs'
if (-not (Test-Path -LiteralPath $Runtime -PathType Leaf)) { throw 'Android Device MCP runtime is missing.' }

$Node = $null
foreach ($Name in @('node.exe','node')) {
    $Candidate = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($Candidate) { $Node = [string]$Candidate.Source; break }
}
if (-not $Node) { throw 'Node.js is required.' }

$Requests = @(
    ([ordered]@{ jsonrpc='2.0'; id=1; method='initialize'; params=[ordered]@{ protocolVersion='2024-11-05'; capabilities=@{}; clientInfo=[ordered]@{ name='evavo-android-mcp-acceptance'; version='1.0.0' } } } | ConvertTo-Json -Compress -Depth 10),
    ([ordered]@{ jsonrpc='2.0'; method='notifications/initialized' } | ConvertTo-Json -Compress -Depth 10),
    ([ordered]@{ jsonrpc='2.0'; id=2; method='tools/list' } | ConvertTo-Json -Compress -Depth 10)
)

$Input = [IO.Path]::GetTempFileName()
$Output = [IO.Path]::GetTempFileName()
$ErrorFile = [IO.Path]::GetTempFileName()
try {
    [IO.File]::WriteAllText($Input, (($Requests -join [Environment]::NewLine) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
    $Process = Start-Process -FilePath $Node -ArgumentList ('"' + $Runtime + '"') -NoNewWindow -PassThru -RedirectStandardInput $Input -RedirectStandardOutput $Output -RedirectStandardError $ErrorFile
    if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
        try { & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null } catch { try { $Process.Kill() } catch {} }
        throw 'Android Device MCP handshake timed out.'
    }
    if ($Process.ExitCode -ne 0) { throw "Android Device MCP exited $($Process.ExitCode)." }
    $Stderr = Get-Content -LiteralPath $ErrorFile -Raw -Encoding UTF8
    if (-not [string]::IsNullOrWhiteSpace($Stderr)) { throw 'Android Device MCP wrote unexpected stderr.' }

    $Responses = @()
    foreach ($Line in @(Get-Content -LiteralPath $Output -Encoding UTF8)) {
        if ([string]::IsNullOrWhiteSpace($Line)) { continue }
        $Responses += ($Line | ConvertFrom-Json -ErrorAction Stop)
    }
    $Init = $Responses | Where-Object { $_.id -eq 1 } | Select-Object -First 1
    if ([string]$Init.result.serverInfo.name -ne 'evavo-android-device-mcp') { throw 'Android Device MCP server identity mismatch.' }
    if ([string]$Init.result.serverInfo.version -ne '1.1.0') { throw 'Android Device MCP version mismatch.' }

    $List = $Responses | Where-Object { $_.id -eq 2 } | Select-Object -First 1
    $Observed = @($List.result.tools | ForEach-Object { [string]$_.name })
    $Expected = @('evavo_android_setup_host','evavo_android_doctor','evavo_android_devices','evavo_android_profile')
    foreach ($Tool in $Expected) {
        if ($Observed -notcontains $Tool) { throw "Android Device MCP missing required tool: $Tool" }
    }
    if ((@($Observed | Select-Object -Unique)).Count -ne $Observed.Count) { throw 'Android Device MCP tool inventory contains duplicates.' }

    [ordered]@{
        schemaVersion = 1
        kind = 'evavo-android-device-mcp-handshake-v1'
        ok = $true
        serverName = 'evavo-android-device-mcp'
        serverVersion = '1.1.0'
        requiredTools = $Expected
        observedToolCount = $Observed.Count
        tabletContacted = $false
        operatorExecutionInvoked = $false
        externalNetworkRequired = $false
    } | ConvertTo-Json -Depth 8
} finally {
    Remove-Item -LiteralPath $Input,$Output,$ErrorFile -Force -ErrorAction SilentlyContinue
}
