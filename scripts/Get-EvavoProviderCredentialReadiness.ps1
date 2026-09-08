[CmdletBinding()]
param([switch]$ProbeCliAuth)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($env:OS-ne'Windows_NT'){throw'EVAVO_PROVIDER_CREDENTIAL_READINESS_WINDOWS_REQUIRED'}

function Has-Value([string]$Name,[string]$Target='Process'){
    $Value=if($Target-eq'User'){[Environment]::GetEnvironmentVariable($Name,'User')}else{[Environment]::GetEnvironmentVariable($Name,'Process')}
    return[bool](-not[string]::IsNullOrWhiteSpace([string]$Value))
}
function Command-Available([string[]]$Names){
    return[bool](Get-Command $Names -CommandType Application -ErrorAction SilentlyContinue|Select-Object -First 1)
}
function Probe-Native([string[]]$Names,[string[]]$Arguments){
    $Command=Get-Command $Names -CommandType Application -ErrorAction SilentlyContinue|Select-Object -First 1
    if(-not$Command){return[ordered]@{available=$false;attempted=$false;passed=$false}}
    if(-not$ProbeCliAuth){return[ordered]@{available=$true;attempted=$false;passed=$false}}
    $Previous=$ErrorActionPreference
    try{
        $ErrorActionPreference='Continue';$global:LASTEXITCODE=0
        & $Command.Source @Arguments 1>$null 2>$null
        $Code=[int]$global:LASTEXITCODE
    }finally{$ErrorActionPreference=$Previous}
    return[ordered]@{available=$true;attempted=$true;passed=[bool]($Code-eq0)}
}

# Credential probes use only already-installed provider CLIs. A readiness/doctor
# operation must not download a package or reinterpret package-resolution failure as
# an authentication result.
$Gh=Probe-Native @('gh.exe','gh') @('auth','status','--hostname','github.com')
$Wrangler=Probe-Native @('wrangler.cmd','wrangler') @('whoami')
$Vercel=Probe-Native @('vercel.cmd','vercel') @('whoami')
$TunnelClient=Command-Available @('tunnel-client.exe','tunnel-client')

$CloudflareTokenSource=if(Has-Value 'CLOUDFLARE_API_TOKEN'){'CLOUDFLARE_API_TOKEN'}elseif(Has-Value 'CF_API_TOKEN'){'CF_API_TOKEN'}else{'wrangler-session-or-none'}
$CloudflareAccountSource=if(Has-Value 'CLOUDFLARE_ACCOUNT_ID'){'CLOUDFLARE_ACCOUNT_ID'}elseif(Has-Value 'CF_ACCOUNT_ID'){'CF_ACCOUNT_ID'}else{'wrangler-session-config-or-none'}
$OpenAiRuntimeSource=if(Has-Value 'CONTROL_PLANE_API_KEY' 'User'){'user-control-plane'}elseif(Has-Value 'CONTROL_PLANE_API_KEY'){'process-control-plane'}elseif(Has-Value 'OPENAI_API_KEY' 'User'){'user-openai'}elseif(Has-Value 'OPENAI_API_KEY'){'process-openai'}else{'none'}
$OpenAiAdmin=[bool]((Has-Value 'OPENAI_ADMIN_KEY' 'User')-or(Has-Value 'OPENAI_ADMIN_KEY'))
$OpenAiScope=[bool]((Has-Value 'OPENAI_WORKSPACE_ID')-or(Has-Value 'OPENAI_ORGANIZATION_ID'))
$TunnelId=[Environment]::GetEnvironmentVariable('EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID','User')
if([string]::IsNullOrWhiteSpace($TunnelId)){$TunnelId=[Environment]::GetEnvironmentVariable('EVAVO_WORKSTATION_OBSERVER_TUNNEL_ID','Process')}
$TunnelIdConfigured=[bool]([string]$TunnelId-match'^tunnel_[0-9a-f]{32}$')

$AuthProbeAttemptedCount=0
$AuthProbePassedCount=0
$AuthProbeFailedCount=0
foreach($Provider in @($Gh,$Wrangler,$Vercel)){
    if($Provider.attempted-eq$true){
        $AuthProbeAttemptedCount++
        if($Provider.passed-eq$true){$AuthProbePassedCount++}else{$AuthProbeFailedCount++}
    }
}
$AuthProbeReady=[bool](
    -not$ProbeCliAuth-or(
        $AuthProbeAttemptedCount-gt0-and
        $AuthProbeFailedCount-eq0
    )
)

[ordered]@{
 schemaVersion=2
 kind='evavo-provider-credential-readiness-v2'
 ok=$AuthProbeReady
 checkedAt=[DateTimeOffset]::UtcNow.ToString('o')
 probeCliAuthRequested=[bool]$ProbeCliAuth
 authProbeAttemptedCount=$AuthProbeAttemptedCount
 authProbePassedCount=$AuthProbePassedCount
 authProbeFailedCount=$AuthProbeFailedCount
 requestedAuthProbePassed=if($ProbeCliAuth){$AuthProbeReady}else{$null}
 github=[ordered]@{cliAvailable=[bool]$Gh.available;authProbeAttempted=[bool]$Gh.attempted;authProbePassed=[bool]$Gh.passed;credentialValueReturned=$false}
 cloudflare=[ordered]@{wranglerAvailable=[bool]$Wrangler.available;authProbeAttempted=[bool]$Wrangler.attempted;authProbePassed=[bool]$Wrangler.passed;credentialSourceCategory=$CloudflareTokenSource;accountSourceCategory=$CloudflareAccountSource;credentialValueReturned=$false;accountIdReturned=$false}
 openAi=[ordered]@{tunnelClientAvailable=$TunnelClient;runtimeCredentialSourceCategory=$OpenAiRuntimeSource;runtimeCredentialConfigured=[bool]($OpenAiRuntimeSource-ne'none');adminCredentialConfigured=$OpenAiAdmin;workspaceOrOrganizationScopeConfigured=$OpenAiScope;tunnelIdConfigured=$TunnelIdConfigured;credentialValueReturned=$false;tunnelIdReturned=$false}
 vercel=[ordered]@{cliAvailable=[bool]$Vercel.available;authProbeAttempted=[bool]$Vercel.attempted;authProbePassed=[bool]$Vercel.passed;credentialValueReturned=$false}
 secretsReadFromGmail=$false
 secretValuesReturned=$false
 environmentValuesReturned=$false
 mutationPerformed=$false
 packageDownloadPerformed=$false
 networkProbePerformed=[bool]($AuthProbeAttemptedCount-gt0)
}|ConvertTo-Json -Depth 10
