[CmdletBinding()]
param(
    [switch]$SetupHost,
    [ValidateRange(30,300)][int]$TimeoutSeconds = 120
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ($env:OS -ne 'Windows_NT') { throw 'EVAVO Android physical bring-up acceptance targets Windows only.' }

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$Runtime = Join-Path $Root 'mcp-server\android-device-mcp.mjs'
if (-not (Test-Path -LiteralPath $Runtime -PathType Leaf)) { throw 'Android Device MCP runtime is missing.' }

$Node = $null
foreach ($Name in @('node.exe','node')) {
    $Candidate = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($Candidate) { $Node = [string]$Candidate.Source; break }
}
if (-not $Node) { throw 'Node.js is required for Android physical bring-up acceptance.' }

$Requests = [System.Collections.Generic.List[string]]::new()
function Add-Request([object]$Value) { $Requests.Add(($Value | ConvertTo-Json -Compress -Depth 20)) }
Add-Request ([ordered]@{ jsonrpc='2.0'; id=1; method='initialize'; params=[ordered]@{ protocolVersion='2024-11-05'; capabilities=@{}; clientInfo=[ordered]@{ name='evavo-android-physical-acceptance'; version='1.0.0' } } })
Add-Request ([ordered]@{ jsonrpc='2.0'; method='notifications/initialized' })
if ($SetupHost) {
    Add-Request ([ordered]@{ jsonrpc='2.0'; id=2; method='tools/call'; params=[ordered]@{ name='evavo_android_setup_host'; arguments=@{} } })
}
Add-Request ([ordered]@{ jsonrpc='2.0'; id=3; method='tools/call'; params=[ordered]@{ name='evavo_android_bringup'; arguments=@{} } })

$Input = [IO.Path]::GetTempFileName()
$Output = [IO.Path]::GetTempFileName()
$ErrorFile = [IO.Path]::GetTempFileName()
try {
    [IO.File]::WriteAllText($Input, (($Requests -join [Environment]::NewLine) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
    $Process = Start-Process -FilePath $Node -ArgumentList ('"' + $Runtime + '"') -NoNewWindow -PassThru -RedirectStandardInput $Input -RedirectStandardOutput $Output -RedirectStandardError $ErrorFile
    if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
        try { & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null } catch { try { $Process.Kill() } catch {} }
        throw 'Android physical bring-up acceptance timed out.'
    }
    if ($Process.ExitCode -ne 0) { throw "Android Device MCP exited $($Process.ExitCode)." }
    $Stderr = Get-Content -LiteralPath $ErrorFile -Raw -Encoding UTF8
    if (-not [string]::IsNullOrWhiteSpace($Stderr)) { throw 'Android Device MCP wrote unexpected stderr.' }

    $Responses = @()
    foreach ($Line in @(Get-Content -LiteralPath $Output -Encoding UTF8)) {
        if ([string]::IsNullOrWhiteSpace($Line)) { continue }
        $Responses += ($Line | ConvertFrom-Json -ErrorAction Stop)
    }

    function Read-ToolPayload([int]$Id) {
        $Response = $Responses | Where-Object { $_.id -eq $Id } | Select-Object -First 1
        if (-not $Response) { throw "Missing MCP response id $Id." }
        if ($Response.result.isError -eq $true) {
            $Text = [string](@($Response.result.content | Where-Object { $_.type -eq 'text' } | Select-Object -First 1).text)
            throw "Android MCP call failed: $Text"
        }
        $Text = [string](@($Response.result.content | Where-Object { $_.type -eq 'text' } | Select-Object -First 1).text)
        if ([string]::IsNullOrWhiteSpace($Text)) { throw "MCP tool call $Id returned no text payload." }
        return $Text | ConvertFrom-Json -ErrorAction Stop
    }

    $Setup = $null
    if ($SetupHost) { $Setup = Read-ToolPayload 2 }
    $Bringup = Read-ToolPayload 3
    if ([string]$Bringup.schema -ne 'evavo_android_device_bringup_v1') { throw 'Android bring-up schema mismatch.' }
    if ($Bringup.executor.fixedCommandSurface -ne $true -or $Bringup.executor.commandTextAcceptedFromCaller -ne $false) { throw 'Android MCP executor authority mismatch.' }

    [ordered]@{
        schemaVersion = 1
        kind = 'evavo-android-physical-mcp-bringup-v1'
        ok = [bool]$Bringup.ok
        completedAt = [DateTimeOffset]::UtcNow.ToString('O')
        setupHostRequested = [bool]$SetupHost
        setupHostCompleted = if ($SetupHost) { [bool]$Setup.ok } else { $null }
        hostReady = [bool]$Bringup.hostReady
        authorisedDeviceCount = [int]$Bringup.authorisedDeviceCount
        deviceCount = [int]$Bringup.deviceCount
        devices = @($Bringup.devices)
        nextAction = [string]$Bringup.nextAction
        fixedCommandSurface = $true
        commandTextAcceptedFromCaller = $false
        credentialValuesReturned = $false
        rawDeviceIdentifiersPrinted = [bool](-not $Bringup.truth.rawDeviceIdentifiersPrinted)
        appInstalledClaimed = [bool]$Bringup.truth.appInstalledClaimed
        gameplayClaimed = [bool]$Bringup.truth.gameplayClaimed
    } | ConvertTo-Json -Depth 16
} finally {
    Remove-Item -LiteralPath $Input,$Output,$ErrorFile -Force -ErrorAction SilentlyContinue
}
