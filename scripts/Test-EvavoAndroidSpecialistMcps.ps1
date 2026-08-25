[CmdletBinding()]
param([ValidateRange(10,120)][int]$TimeoutSeconds = 30)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$Node = (Get-Command node.exe,node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $Node) { throw 'Node.js is required.' }

$Servers = @(
    [ordered]@{ file='mcp-server\android-app-mcp.mjs'; name='evavo-android-app-mcp'; version='1.0.0'; tools=@('evavo_android_app_status','evavo_android_app_health','evavo_android_app_launch','evavo_android_app_stop','evavo_android_app_diagnostics','evavo_android_app_ui_snapshot','evavo_android_game_input','evavo_android_app_grant_development_permissions','evavo_android_app_clear_data','evavo_android_app_uninstall'); readOnlyOnly=$false },
    [ordered]@{ file='mcp-server\android-observer-mcp.mjs'; name='evavo-android-observer-mcp'; version='1.1.0'; tools=@('evavo_android_observer_usb','evavo_android_observer_bringup','evavo_android_observer_profile','evavo_android_observer_app_status','evavo_android_observer_app_health','evavo_android_observer_app_diagnostics','evavo_android_observer_app_screenshot'); readOnlyOnly=$true },
    [ordered]@{ file='mcp-server\glasses-android-mcp.mjs'; name='evavo-glasses-android-mcp'; version='1.1.0'; tools=@('evavo_glasses_android_doctor','evavo_glasses_android_build','evavo_glasses_android_test_device','evavo_glasses_android_build_and_test','evavo_glasses_android_acceptance_status'); readOnlyOnly=$false },
    [ordered]@{ file='mcp-server\glasses-tab-a-mcp.mjs'; name='evavo-glasses-tab-a-mcp'; version='1.7.0'; tools=@('evavo_glasses_tab_a_acceptance'); readOnlyOnly=$false },
    [ordered]@{ file='mcp-server\godot-android-physical-mcp.mjs'; name='evavo-godot-android-physical-mcp'; version='1.0.0'; tools=@('evavo_godot_android_physical_journey'); readOnlyOnly=$false }
)

$Results = @()
foreach ($Server in $Servers) {
    $Runtime = Join-Path $Root $Server.file
    if (-not (Test-Path -LiteralPath $Runtime -PathType Leaf)) { throw "Missing MCP runtime: $($Server.file)" }
    $Input = [IO.Path]::GetTempFileName()
    $Output = [IO.Path]::GetTempFileName()
    $ErrorFile = [IO.Path]::GetTempFileName()
    try {
        $Requests = @(
            ([ordered]@{jsonrpc='2.0';id=1;method='initialize';params=[ordered]@{protocolVersion='2024-11-05';capabilities=@{};clientInfo=[ordered]@{name='evavo-specialist-acceptance';version='1.0.0'}}}|ConvertTo-Json -Compress -Depth 10),
            ([ordered]@{jsonrpc='2.0';method='notifications/initialized'}|ConvertTo-Json -Compress -Depth 10),
            ([ordered]@{jsonrpc='2.0';id=2;method='tools/list'}|ConvertTo-Json -Compress -Depth 10)
        )
        [IO.File]::WriteAllText($Input,(($Requests -join [Environment]::NewLine)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
        $Process = Start-Process -FilePath $Node -ArgumentList ('"'+$Runtime+'"') -NoNewWindow -PassThru -RedirectStandardInput $Input -RedirectStandardOutput $Output -RedirectStandardError $ErrorFile
        if (-not $Process.WaitForExit($TimeoutSeconds*1000)) {
            try { & taskkill.exe /PID $Process.Id /T /F 2>$null|Out-Null } catch {}
            throw "$($Server.name) handshake timed out."
        }
        if ($Process.ExitCode -ne 0) { throw "$($Server.name) exited $($Process.ExitCode)." }
        if (-not [string]::IsNullOrWhiteSpace((Get-Content -LiteralPath $ErrorFile -Raw -Encoding UTF8))) { throw "$($Server.name) wrote unexpected stderr." }
        $Responses = @(Get-Content -LiteralPath $Output -Encoding UTF8 | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json -ErrorAction Stop })
        $Init = $Responses | Where-Object {$_.id -eq 1} | Select-Object -First 1
        if ([string]$Init.result.serverInfo.name -ne [string]$Server.name -or [string]$Init.result.serverInfo.version -ne [string]$Server.version) { throw "$($Server.name) identity/version mismatch." }
        $List = $Responses | Where-Object {$_.id -eq 2} | Select-Object -First 1
        $Observed = @($List.result.tools | ForEach-Object {[string]$_.name})
        foreach ($Tool in $Server.tools) { if ($Observed -notcontains $Tool) { throw "$($Server.name) missing tool $Tool" } }
        if ($Server.readOnlyOnly) {
            foreach ($Tool in @($List.result.tools)) {
                if ($Tool.annotations.readOnlyHint -ne $true -or $Tool.annotations.destructiveHint -ne $false) { throw "$($Server.name) tool $($Tool.name) is not explicitly read-only." }
            }
        }
        $Results += [ordered]@{server=$Server.name;version=$Server.version;toolCount=$Observed.Count;requiredTools=$Server.tools;readOnlyOnly=[bool]$Server.readOnlyOnly;tabletContacted=$false;operatorExecutionInvoked=$false;durableExecutionInvoked=$false}
    }
    finally {
        Remove-Item -LiteralPath $Input,$Output,$ErrorFile -Force -ErrorAction SilentlyContinue
    }
}

[ordered]@{
    schemaVersion=1
    kind='evavo-android-specialist-mcp-handshake-v1'
    ok=$true
    servers=$Results
    tabletContacted=$false
    operatorExecutionInvoked=$false
    durableExecutionInvoked=$false
    externalNetworkRequired=$false
} | ConvertTo-Json -Depth 12
