[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$Installer = Join-Path $PSScriptRoot 'Install-EvavoPhysicalDeviceAgentAccess.ps1'
if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw 'Physical-device agent installer is missing.' }

$tokens = $null
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($Installer,[ref]$tokens,[ref]$errors)
if (@($errors).Count -gt 0) { throw "Physical-device installer has PowerShell parse errors: $(@($errors)[0].Message)" }
$source = Get-Content -LiteralPath $Installer -Raw -Encoding UTF8

$required = @(
    'Install-EvavoLocalAgentRestGateway045.ps1',
    '-StartNow -EnableOperatorExec',
    'setup-host-tools.ps1',
    'diagnose-windows-usb.ps1',
    'bringup-cli.mjs',
    'claude.Source mcp add-json --scope user',
    'codex.Source mcp add',
    'default_tools_approval_mode = `"auto`"',
    'physical-android.mcp.json',
    'evavo-godot-android-physical',
    'evavo-glasses-tab-a',
    'deviceConsentCannotBeBypassedByHostAutomation = $true',
    'broadArbitraryShellAutoAllowed = $false',
    'destructiveSystemPackageAuthorityGranted = $false'
)
foreach ($needle in $required) { if (-not $source.Contains($needle)) { throw "Physical-device installer contract missing: $needle" } }

$forbidden = @(
    'dangerously-skip-permissions',
    'bypassPermissions',
    'mcp__evavo-local-agent-executor',
    'mcp__evavo-local-execution',
    'adb shell ',
    'rawAdbSerialReturned = $true',
    'destructiveSystemPackageAuthorityGranted = $true'
)
foreach ($needle in $forbidden) { if ($source.Contains($needle)) { throw "Physical-device installer contains forbidden broad authority: $needle" } }

[ordered]@{
    schemaVersion = 1
    kind = 'evavo-physical-device-agent-access-contract-v1'
    ok = $true
    powershellSyntaxValid = $true
    gateway045Required = $true
    claudeUserMcpRegistrationRequired = $true
    codexUserMcpRegistrationRequired = $true
    clientNeutralBundleRequired = $true
    specialistAutoApprovalOnly = $true
    broadShellAutoApproval = $false
    androidConsentBypassAttempted = $false
    systemPackageDestructionGranted = $false
} | ConvertTo-Json -Depth 8
