[CmdletBinding()]
param(
    [string]$GitRoot = 'C:\GitRepos',
    [switch]$SkipAndroidHostSetup,
    [switch]$SkipClaudeCode,
    [switch]$SkipLiveProbe,
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ($env:OS -ne 'Windows_NT') { throw 'EVAVO physical-device agent access installer currently targets Windows.' }
if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required.' }
if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }

$GitRoot = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($GitRoot)).TrimEnd('\')
$AgentRoot = Join-Path $GitRoot 'evavo-agent-infrastructure'
$StorageRoot = Join-Path $GitRoot 'evavo-local-storage'
$BridgeRoot = Join-Path $GitRoot 'evavo-android-device-bridge'
foreach ($Path in @($AgentRoot,$StorageRoot,$BridgeRoot)) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "Required EVAVO checkout is unavailable: $Path" }
}

$GatewayInstaller = Join-Path $StorageRoot 'scripts\Install-EvavoLocalAgentRestGateway045.ps1'
$HostSetup = Join-Path $BridgeRoot 'scripts\setup-host-tools.ps1'
$BringupCli = Join-Path $BridgeRoot 'src\bringup-cli.mjs'
$UsbDiagnostics = Join-Path $BridgeRoot 'scripts\diagnose-windows-usb.ps1'
foreach ($Path in @($GatewayInstaller,$HostSetup,$BringupCli,$UsbDiagnostics)) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required EVAVO physical-device runtime is unavailable: $Path" }
}

function ConvertTo-OrderedMap {
    param([object]$Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        $map = [ordered]@{}
        foreach ($property in $Value.PSObject.Properties) { $map[$property.Name] = ConvertTo-OrderedMap $property.Value }
        return $map
    }
    if ($Value -is [System.Collections.IDictionary]) {
        $map = [ordered]@{}
        foreach ($key in $Value.Keys) { $map[[string]$key] = ConvertTo-OrderedMap $Value[$key] }
        return $map
    }
    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        return @($Value | ForEach-Object { ConvertTo-OrderedMap $_ })
    }
    return $Value
}

function Invoke-JsonProcess {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [Parameter(Mandatory=$true)][string[]]$Arguments,
        [string]$WorkingDirectory = $AgentRoot,
        [ValidateRange(5,4000)][int]$TimeoutSeconds = 120,
        [switch]$AllowFailure
    )
    $stdout = [IO.Path]::GetTempFileName(); $stderr = [IO.Path]::GetTempFileName()
    try {
        $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -NoNewWindow -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            try { & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null } catch { try { $process.Kill() } catch {} }
            throw "Timed out after $TimeoutSeconds seconds: $FilePath"
        }
        $out = (Get-Content -LiteralPath $stdout -Raw -Encoding UTF8).Trim()
        $err = (Get-Content -LiteralPath $stderr -Raw -Encoding UTF8).Trim()
        $text = if ($out) { $out } else { $err }
        if ($process.ExitCode -ne 0 -and -not $AllowFailure) { throw "Command failed with exit code $($process.ExitCode): $FilePath" }
        $value = $null
        if ($text) {
            try { $value = $text | ConvertFrom-Json -ErrorAction Stop } catch { if (-not $AllowFailure) { throw "Command returned invalid JSON: $FilePath" } }
        }
        return [pscustomobject]@{ ExitCode=$process.ExitCode; Json=$value; Stdout=$out; Stderr=$err }
    } finally {
        Remove-Item -LiteralPath $stdout,$stderr -Force -ErrorAction SilentlyContinue
    }
}

# 1. Persist the authenticated loopback execution service with the reviewed one-hour operator ceiling.
$gatewayRaw = (& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $GatewayInstaller -StartNow -EnableOperatorExec | Out-String).Trim()
if (-not $gatewayRaw) { throw 'Local Agent REST gateway installer returned no receipt.' }
$gateway = $gatewayRaw | ConvertFrom-Json -ErrorAction Stop
if ($gateway.ok -ne $true -or $gateway.healthReady -ne $true -or [int]$gateway.operatorTimeoutMaxSeconds -ne 3600) {
    throw 'Local Agent REST gateway 0.45 did not become healthy with the reviewed long operator lane.'
}

# 2. Provision/reuse ADB + APK inspection tooling. This is host-only and does not mutate a device.
$hostSetupReceipt = $null
if (-not $SkipAndroidHostSetup) {
    $setup = Invoke-JsonProcess -FilePath 'powershell.exe' -Arguments @('-NoProfile','-ExecutionPolicy','Bypass','-File',$HostSetup,'-Json') -WorkingDirectory $BridgeRoot -TimeoutSeconds 600
    $hostSetupReceipt = $setup.Json
    if (-not $hostSetupReceipt -or $hostSetupReceipt.ok -ne $true) { throw 'Android host tooling setup did not report success.' }
}

# 3. Register narrow physical-device MCPs globally for Claude Code and allow those MCP servers without per-call prompts.
$claude = Get-Command claude.exe,claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$claudeConfigured = $false
$claudeServers = @(
    [ordered]@{ name='evavo-android-device'; file=(Join-Path $AgentRoot 'mcp-server\android-device-mcp.mjs') },
    [ordered]@{ name='evavo-android-app'; file=(Join-Path $AgentRoot 'mcp-server\android-app-mcp.mjs') },
    [ordered]@{ name='evavo-glasses-android'; file=(Join-Path $AgentRoot 'mcp-server\glasses-android-mcp.mjs') },
    [ordered]@{ name='evavo-glasses-tab-a'; file=(Join-Path $AgentRoot 'mcp-server\glasses-tab-a-mcp.mjs') },
    [ordered]@{ name='evavo-godot-android-physical'; file=(Join-Path $AgentRoot 'mcp-server\godot-android-physical-mcp.mjs') }
)
foreach ($Server in $claudeServers) {
    if (-not (Test-Path -LiteralPath $Server.file -PathType Leaf)) { throw "MCP runtime missing: $($Server.file)" }
}

if (-not $SkipClaudeCode -and $claude) {
    foreach ($Server in $claudeServers) {
        # Remove only the user-scoped EVAVO registration; ignore absence so installation stays idempotent.
        & $claude.Source mcp remove $Server.name --scope user *> $null
        $definition = [ordered]@{ type='stdio'; command='node'; args=@($Server.file); env=@{} } | ConvertTo-Json -Compress -Depth 6
        $add = & $claude.Source mcp add-json --scope user $Server.name $definition 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { throw "Claude Code failed to register user MCP $($Server.name): $add" }
        $get = & $claude.Source mcp get $Server.name 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0 -or $get -notmatch [regex]::Escape($Server.name)) { throw "Claude Code did not verify MCP registration $($Server.name)." }
    }

    $ClaudeSettingsRoot = Join-Path $env:USERPROFILE '.claude'
    $ClaudeSettings = Join-Path $ClaudeSettingsRoot 'settings.json'
    New-Item -ItemType Directory -Force -Path $ClaudeSettingsRoot | Out-Null
    $settings = [ordered]@{}
    if (Test-Path -LiteralPath $ClaudeSettings -PathType Leaf) {
        try { $settings = ConvertTo-OrderedMap (Get-Content -LiteralPath $ClaudeSettings -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop) }
        catch { throw 'Existing Claude Code settings.json is not valid JSON; refusing to overwrite it.' }
    }
    if (-not $settings.Contains('permissions') -or $settings.permissions -isnot [System.Collections.IDictionary]) { $settings.permissions = [ordered]@{} }
    $permissions = $settings.permissions
    $existingAllow = @()
    if ($permissions.Contains('allow')) { $existingAllow = @($permissions.allow | ForEach-Object { [string]$_ }) }
    $managedAllow = @($claudeServers | ForEach-Object { "mcp__$($_.name)" })
    $permissions.allow = @($existingAllow + $managedAllow | Where-Object { $_ } | Sort-Object -Unique)
    $temp = "$ClaudeSettings.$PID.tmp"
    try {
        [IO.File]::WriteAllText($temp,(($settings | ConvertTo-Json -Depth 30)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temp -Destination $ClaudeSettings -Force
    } finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
    $claudeConfigured = $true
}

# 4. Persist a client-neutral managed MCP bundle that any stdio-MCP agent can consume directly.
$managedRoot = Join-Path $env:LOCALAPPDATA 'EVAVO\AgentClients'
New-Item -ItemType Directory -Force -Path $managedRoot | Out-Null
$managedConfigPath = Join-Path $managedRoot 'physical-android.mcp.json'
$servers = [ordered]@{}
foreach ($Server in $claudeServers) {
    $servers[$Server.name] = [ordered]@{ command='node'; args=@($Server.file); env=@{} }
}
$managedConfig = [ordered]@{ schemaVersion=1; kind='evavo-physical-android-mcp-bundle-v1'; mcpServers=$servers }
$tempManaged = "$managedConfigPath.$PID.tmp"
try {
    [IO.File]::WriteAllText($tempManaged,(($managedConfig | ConvertTo-Json -Depth 12)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tempManaged -Destination $managedConfigPath -Force
} finally { Remove-Item -LiteralPath $tempManaged -Force -ErrorAction SilentlyContinue }

# 5. Read-only live visibility probe: Windows USB/PnP plus ADB bring-up. No app/device mutation occurs here.
$usb = $null; $bringup = $null
if (-not $SkipLiveProbe) {
    $usbResult = Invoke-JsonProcess -FilePath 'powershell.exe' -Arguments @('-NoProfile','-ExecutionPolicy','Bypass','-File',$UsbDiagnostics,'-Json') -WorkingDirectory $BridgeRoot -TimeoutSeconds 90 -AllowFailure
    $usb = $usbResult.Json
    $bringupResult = Invoke-JsonProcess -FilePath 'node.exe' -Arguments @($BringupCli,'--json') -WorkingDirectory $BridgeRoot -TimeoutSeconds 120 -AllowFailure
    $bringup = $bringupResult.Json
}

$authorised = if ($bringup -and $bringup.devices) { @($bringup.devices | Where-Object { $_.state -eq 'device' }) } else { @() }
$result = [ordered]@{
    schemaVersion = 1
    kind = 'evavo-physical-device-agent-access-installation-v1'
    ok = $true
    gateway045 = [ordered]@{
        installed = $true
        healthy = [bool]$gateway.healthReady
        operatorExecutionEnabled = [bool]$gateway.operatorExecEnabled
        operatorTimeoutMaxSeconds = [int]$gateway.operatorTimeoutMaxSeconds
        loopbackOnly = $true
    }
    androidHostSetupRequested = -not [bool]$SkipAndroidHostSetup
    androidHostReady = if ($hostSetupReceipt) { [bool]$hostSetupReceipt.ok } else { $null }
    claudeCodeAvailable = [bool]$claude
    claudeCodeConfigured = $claudeConfigured
    claudeCodeAutoAllowedSpecialistServers = if ($claudeConfigured) { @($claudeServers.name) } else { @() }
    broadArbitraryShellAutoAllowed = $false
    managedMcpBundleWritten = $true
    managedMcpServerCount = $claudeServers.Count
    liveProbeRequested = -not [bool]$SkipLiveProbe
    windowsUsb = $usb
    androidBringup = $bringup
    authorisedPhysicalDeviceCount = @($authorised | Where-Object { $_.deviceClass -eq 'physical' }).Count
    needsAndroidDeviceConsent = if ($SkipLiveProbe) { $null } else { @($authorised).Count -eq 0 }
    deviceConsentCannotBeBypassedByHostAutomation = $true
    bluetoothUsedAsAdbTransport = $false
    rawAdbSerialReturned = $false
    credentialsReturned = $false
    destructiveSystemPackageAuthorityGranted = $false
}

$result | ConvertTo-Json -Depth 20
