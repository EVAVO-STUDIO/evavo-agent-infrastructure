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
    'evavo_glasses_android_tab_a_install_v3',
    'deterministicSdkProvisionerRequired: true',
    'sdkPackageRegistrationVerified: true',
    'sdkRequiredFilesVerified: true',
    'gradleSdkBindingVerified: true',
    'android37PlatformMetadataVerified: true',
    'androidBuildToolsVersion: "36.0.0"',
    'install.androidSdkPackageManager !== "sdkmanager"',
    'install.androidSdkProvisioningCli !== "tested-node-provisioner"',
    'install.androidSdkProvisionReceiptSchema !== "evavo_android_sdk_provision_v1"',
    'install.androidSdkPackageRegistrationVerified !== true',
    'install.androidSdkRequiredFilesVerified !== true',
    'install.androidGradleSdkBindingWritten !== true',
    'Number(install.androidPlatformApiLevel) !== 37',
    'foregroundVisualProofObserved !== true',
    'powershell5NativeStderrHardened: true',
    'execute-prepared-local-request.py',
    'godmode-android-tab-a.prepare.json',
    '55 * 60 * 1000',
    'callerSuppliedTargetRefAccepted: false',
    'callerSuppliedCommandAccepted: false',
    'systemPackageMutationAllowed: false',
    'arbitraryAdbShellAccepted: false',
    'bluetoothUsedAsAdbTransport: false',
    'foregroundScreenshotReturned',
    'crashedOrAnrObserved === true',
    'runtimeHealthObserved !== true',
    'healthSchema !== "evavo_android_app_health_v1"',
    'does not accept caller-supplied arguments',
    'version: "1.7.0"'
)
foreach ($Token in $Required) {
    if (-not $Source.Contains($Token)) { throw "Tab A MCP contract is missing token: $Token" }
}

$Forbidden = @(
    'evavo_glasses_android_tab_a_install_v1',
    'evavo_glasses_android_tab_a_install_v2',
    'currentAndroidCliRequired: true',
    'androidSdkProvisioningCli !== "android-cli"',
    'android37PackageDiscoveredFromCatalog: true',
    'shell: true',
    'exec(',
    'execSync(',
    'Invoke-Expression',
    'adb shell',
    'fastboot',
    'systemPackageMutationAllowed: true'
)
foreach ($Token in $Forbidden) {
    if ($Source.Contains($Token)) { throw "Tab A MCP contains forbidden token: $Token" }
}

[ordered]@{
    schemaVersion = 6
    kind = 'evavo-glasses-tab-a-mcp-static-contract-v6'
    ok = $true
    runtime = 'mcp-server/glasses-tab-a-mcp.mjs'
    version = '1.7.0'
    zeroArgumentTool = $true
    durableExecution = $true
    physicalDeviceExecution = $true
    deterministicSdkProvisionerRequired = $true
    sdkPackageRegistrationVerified = $true
    sdkRequiredFilesVerified = $true
    gradleSdkBindingVerified = $true
    android37PlatformMetadataVerified = $true
    androidBuildToolsVersion = '36.0.0'
    foregroundScreenshotReturned = $true
    powershell5NativeStderrHardened = $true
    callerSuppliedTargetRefAccepted = $false
    callerSuppliedCommandAccepted = $false
    systemPackageMutationAllowed = $false
    arbitraryAdbShellAccepted = $false
    bluetoothUsedAsAdbTransport = $false
    tabletContacted = $false
    durableExecutionInvoked = $false
} | ConvertTo-Json -Depth 8
