[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][Security.SecureString]$DispatchToken
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($env:OS-ne'Windows_NT'){throw'EVAVO_REMOTE_MCP_RELAY_DISPATCH_SECRET_WINDOWS_REQUIRED'}

$Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$Package=Join-Path $Root 'packages\remote-mcp-relay'
$Config=Join-Path $Package 'wrangler.jsonc'
if(-not(Test-Path -LiteralPath $Config -PathType Leaf)){throw'EVAVO_REMOTE_MCP_RELAY_DISPATCH_SECRET_CONFIG_MISSING'}
$Npx=(Get-Command npx.cmd,npx -CommandType Application -ErrorAction Stop|Select-Object -First 1).Source

$Bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($DispatchToken)
$Plain=$null
try{
    $Plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
    if([string]::IsNullOrWhiteSpace($Plain)-or$Plain.Length-lt32){throw'EVAVO_REMOTE_MCP_RELAY_DISPATCH_SECRET_TOO_SHORT'}
    Push-Location -LiteralPath $Package
    try{
        $Previous=$ErrorActionPreference
        try{
            $ErrorActionPreference='Continue'
            $global:LASTEXITCODE=0
            $Rows=@($Plain|&$Npx wrangler secret put DISPATCH_TOKEN 2>&1)
            $Code=[int]$global:LASTEXITCODE
        }finally{$ErrorActionPreference=$Previous}
        if($Code-ne0){throw'EVAVO_REMOTE_MCP_RELAY_DISPATCH_SECRET_WRANGLER_FAILED'}
    }finally{Pop-Location}
}finally{
    if($Bstr-ne[IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)}
    $Plain=$null
}

[ordered]@{
    schemaVersion=1
    kind='evavo-remote-mcp-relay-dispatch-secret-rotation'
    ok=$true
    completedAt=[DateTimeOffset]::UtcNow.ToString('o')
    workerSecret='DISPATCH_TOKEN'
    secretValueReturned=$false
    secretInCommandLine=$false
    secretInRepository=$false
    callerMustRetainCredentialSecurely=$true
    githubActionsRequired=$false
    vercelRequired=$false
    paidRelayRequired=$false
}|ConvertTo-Json -Depth 8
