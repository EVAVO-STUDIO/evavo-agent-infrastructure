[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Runtime = Join-Path $Root 'mcp-server\glasses-tab-a-mcp.mjs'
if (-not (Test-Path -LiteralPath $Runtime -PathType Leaf)) { throw 'Missing glasses-tab-a-mcp.mjs.' }
$Source = Get-Content -LiteralPath $Runtime -Raw -Encoding UTF8

$Required = @(
    'evavo_glasses_tab_a_acceptance',
    'evavo_glasses_android_tab_a_install_v2',
    'powershell5NativeStderrHardened: true',
    'C:\\GitRepos\\evavo-local-compute',
    'C:\\GitRepos\\evavo-glasses',
    'execute-prepared-local-request.py',
    'godmode-android-tab-a.prepare.json',
    '55 * 60 * 1000',
    'callerSuppliedTargetRefAccepted: false',
    'callerSuppliedCommandAccepted: false',
    'callerSuppliedPackageAccepted: false',
    'callerSuppliedApkAccepted: false',
    'systemPackageMutationAllowed: false',
    'arbitraryAdbShellAccepted: false',
    'bluetoothUsedAsAdbTransport: false',
    'physicalExecutionReceiptRequired',
    'foregroundScreenshotReturned',
    'device-install',
    'device-launch',
    'device-observe',
    'physicalDeviceExecutionClaimed !== true',
    'crashedOrAnrObserved === true',
    'runtimeHealthObserved !== true',
    'healthSchema !== "evavo_android_app_health_v1"',
    'arguments must be an object',
    'does not accept caller-supplied arguments'
)
foreach ($Token in $Required) {
    if (-not $Source.Contains($Token)) { throw "Tab A MCP contract is missing token: $Token" }
}

$Forbidden = @(
    'evavo_glasses_android_tab_a_install_v1',
    'shell: true',
    'exec(',
    'execSync(',
    'Invoke-Expression',
    'adb shell',
    'fastboot',
    'callerSuppliedTargetRefAccepted: true',
    'callerSuppliedCommandAccepted: true',
    'systemPackageMutationAllowed: true',
    'bluetoothUsedAsAdbTransport: true'
)
foreach ($Token in $Forbidden) {
    if ($Source.Contains($Token)) { throw "Tab A MCP contains forbidden token: $Token" }
}

[ordered]@{
    schemaVersion = 2
    kind = 'evavo-glasses-tab-a-mcp-static-contract-v2'
    ok = $true
    runtime = 'mcp-server/glasses-tab-a-mcp.mjs'
    zeroArgumentTool = $true
    durableExecution = $true
    physicalDeviceExecution = $true
    foregroundScreenshotReturned = $true
    powershell5NativeStderrHardened = $true
    callerSuppliedTargetRefAccepted = $false
    callerSuppliedCommandAccepted = $false
    callerSuppliedPackageAccepted = $false
    callerSuppliedApkAccepted = $false
    systemPackageMutationAllowed = $false
    arbitraryAdbShellAccepted = $false
    bluetoothUsedAsAdbTransport = $false
    tabletContacted = $false
    durableExecutionInvoked = $false
} | ConvertTo-Json -Depth 8
