[CmdletBinding()]
param(
    [string]$GitRoot = 'C:\GitRepos',
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:OS -ne 'Windows_NT') { throw 'EVAVO physical-device access diagnostic targets Windows.' }
if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required.' }
if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }

$GitRoot = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($GitRoot)).TrimEnd('\')
$AgentRoot = Join-Path $GitRoot 'evavo-agent-infrastructure'
$BridgeRoot = Join-Path $GitRoot 'evavo-android-device-bridge'
$UsbDiagnostics = Join-Path $BridgeRoot 'scripts\diagnose-windows-usb.ps1'
$BringupCli = Join-Path $BridgeRoot 'src\bringup-cli.mjs'
$SpecialistHandshake = Join-Path $AgentRoot 'scripts\Test-EvavoAndroidSpecialistMcps.ps1'
foreach ($Path in @($UsbDiagnostics,$BringupCli,$SpecialistHandshake)) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required physical-device diagnostic component is unavailable: $Path" }
}

function Invoke-Json {
    param([string]$FilePath,[string[]]$Arguments,[string]$WorkingDirectory,[int]$TimeoutSeconds=120)
    $stdout=[IO.Path]::GetTempFileName();$stderr=[IO.Path]::GetTempFileName()
    try {
        $p=Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -NoNewWindow -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        if(-not $p.WaitForExit($TimeoutSeconds*1000)){try{& taskkill.exe /PID $p.Id /T /F 2>$null|Out-Null}catch{};throw "Diagnostic timed out: $FilePath"}
        $out=(Get-Content -LiteralPath $stdout -Raw -Encoding UTF8).Trim();$err=(Get-Content -LiteralPath $stderr -Raw -Encoding UTF8).Trim()
        $text=if($out){$out}else{$err};$value=$null
        if($text){try{$value=$text|ConvertFrom-Json -ErrorAction Stop}catch{}}
        return [pscustomobject]@{ExitCode=$p.ExitCode;Json=$value}
    } finally {Remove-Item -LiteralPath $stdout,$stderr -Force -ErrorAction SilentlyContinue}
}

$health=$null
try{$health=Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:4329/health' -TimeoutSec 3 -ErrorAction Stop}catch{}
$gatewayReady=[bool]($health -and $health.ok -eq $true -and $health.loopbackOnly -eq $true -and $health.operatorTimeoutBounded -eq $true -and [int]$health.operatorTimeoutMaxSeconds -ge 3300)

$handshake=Invoke-Json -FilePath 'powershell.exe' -Arguments @('-NoProfile','-ExecutionPolicy','Bypass','-File',$SpecialistHandshake) -WorkingDirectory $AgentRoot -TimeoutSeconds 120
$mcpReady=[bool]($handshake.ExitCode -eq 0 -and $handshake.Json -and $handshake.Json.ok -eq $true)

$usbResult=Invoke-Json -FilePath 'powershell.exe' -Arguments @('-NoProfile','-ExecutionPolicy','Bypass','-File',$UsbDiagnostics,'-Json') -WorkingDirectory $BridgeRoot -TimeoutSeconds 90
$usb=$usbResult.Json
$bringupResult=Invoke-Json -FilePath 'node.exe' -Arguments @($BringupCli,'--json') -WorkingDirectory $BridgeRoot -TimeoutSeconds 120
$bringup=$bringupResult.Json
$devices=if($bringup -and $bringup.devices){@($bringup.devices)}else{@()}
$authorised=@($devices|Where-Object{$_.state -eq 'device'})
$physical=@($authorised|Where-Object{$_.deviceClass -eq 'physical'})
$unauthorised=@($devices|Where-Object{$_.state -eq 'unauthorized'})

$claude=Get-Command claude.exe,claude -CommandType Application -ErrorAction SilentlyContinue|Select-Object -First 1
$claudeServers=@()
if($claude){$text=& $claude.Source mcp list 2>&1|Out-String;foreach($name in @('evavo-android-device','evavo-android-app','evavo-glasses-android','evavo-glasses-tab-a','evavo-godot-android-physical')){if($text -match [regex]::Escape($name)){$claudeServers+=$name}}}
$codex=Get-Command codex.exe,codex -CommandType Application -ErrorAction SilentlyContinue|Select-Object -First 1
$codexServers=@()
if($codex){$text=& $codex.Source mcp list 2>&1|Out-String;foreach($name in @('evavo-android-device','evavo-android-app','evavo-glasses-android','evavo-glasses-tab-a','evavo-godot-android-physical')){if($text -match [regex]::Escape($name)){$codexServers+=$name}}}

$status=if(-not $gatewayReady){'gateway-not-ready'}elseif(-not $mcpReady){'mcp-runtime-not-ready'}elseif($physical.Count -gt 0){'physical-android-ready'}elseif($unauthorised.Count -gt 0){'android-rsa-approval-required'}elseif($usb -and $usb.androidLikePresentCount -gt 0){'windows-sees-device-adb-not-authorised'}else{'no-android-device-visible'}
$result=[ordered]@{
    schemaVersion=1
    kind='evavo-physical-device-agent-access-diagnostic-v1'
    ok=$gatewayReady -and $mcpReady
    status=$status
    gatewayReady=$gatewayReady
    specialistMcpRuntimeReady=$mcpReady
    windowsUsb=$usb
    androidBringup=$bringup
    authorisedAndroidDeviceCount=$authorised.Count
    authorisedPhysicalDeviceCount=$physical.Count
    unauthorisedDeviceCount=$unauthorised.Count
    claudeCodeAvailable=[bool]$claude
    claudeSpecialistServerCount=$claudeServers.Count
    codexAvailable=[bool]$codex
    codexSpecialistServerCount=$codexServers.Count
    nextAction=if($physical.Count -gt 0){'Agents may use the privacy-safe targetRef for Android application or physical Godot testing.'}elseif($unauthorised.Count -gt 0){'Unlock the tablet and approve this workstation USB debugging RSA key once.'}elseif($usb -and $usb.androidLikePresentCount -gt 0){'Windows sees an Android/Samsung USB device but ADB is not authorised; ensure USB debugging is enabled and the ADB interface/driver is healthy.'}else{'No Android-like USB device is currently visible to Windows.'}
    tabletMutationPerformed=$false
    appInstalledClaimed=$false
    gameplayClaimed=$false
    rawAdbSerialReturned=$false
    credentialsReturned=$false
}
$result|ConvertTo-Json -Depth 20
