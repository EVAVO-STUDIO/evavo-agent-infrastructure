[CmdletBinding()]
param(
    [string]$RelayBaseUrl = '',
    [string]$LocalStorageRoot = '',
    [switch]$SkipPackageInstall,
    [switch]$SkipWorkstationClientInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($env:OS-ne'Windows_NT'){throw'EVAVO_REMOTE_MCP_RELAY_DEPLOY_V2_WINDOWS_REQUIRED'}

$V1=Join-Path $PSScriptRoot 'Deploy-EvavoRemoteMcpRelay.ps1'
if(-not(Test-Path -LiteralPath $V1 -PathType Leaf)){throw'EVAVO_REMOTE_MCP_RELAY_DEPLOY_V2_V1_MISSING'}
$t=$null;$e=$null;[Management.Automation.Language.Parser]::ParseFile($V1,[ref]$t,[ref]$e)|Out-Null;if(@($e).Count-gt0){throw'EVAVO_REMOTE_MCP_RELAY_DEPLOY_V2_V1_PARSE_FAILED'}

$CredentialSource='wrangler-session-or-provider-default';$AccountSource='wrangler-session-or-config';$MappedToken=$false;$MappedAccount=$false
if(-not[string]::IsNullOrWhiteSpace([string]$env:CLOUDFLARE_API_TOKEN)){$CredentialSource='CLOUDFLARE_API_TOKEN'}elseif(-not[string]::IsNullOrWhiteSpace([string]$env:CF_API_TOKEN)){$env:CLOUDFLARE_API_TOKEN=[string]$env:CF_API_TOKEN;$CredentialSource='CF_API_TOKEN';$MappedToken=$true}
if(-not[string]::IsNullOrWhiteSpace([string]$env:CLOUDFLARE_ACCOUNT_ID)){$AccountSource='CLOUDFLARE_ACCOUNT_ID'}elseif(-not[string]::IsNullOrWhiteSpace([string]$env:CF_ACCOUNT_ID)){$env:CLOUDFLARE_ACCOUNT_ID=[string]$env:CF_ACCOUNT_ID;$AccountSource='CF_ACCOUNT_ID';$MappedAccount=$true}

$SelectedLocalStorage=$null;$SelectedSourceCategory='not-needed'
if(-not$SkipWorkstationClientInstall){
    $Git=Get-Command git.exe,git -CommandType Application -ErrorAction SilentlyContinue|Select-Object -First 1
    if(-not$Git){throw'EVAVO_REMOTE_MCP_RELAY_DEPLOY_V2_GIT_REQUIRED_FOR_LOCAL_STORAGE_ADMISSION'}
    function Test-AdmittedLocalStorageSource([string]$Candidate){
        if([string]::IsNullOrWhiteSpace($Candidate)){return$false}
        try{$Root=[IO.Path]::GetFullPath($Candidate)}catch{return$false}
        if(-not(Test-Path -LiteralPath (Join-Path $Root '.git') -PathType Container)-or-not(Test-Path -LiteralPath (Join-Path $Root 'scripts\Install-EvavoRemoteMcpRelayClient.ps1') -PathType Leaf)){return$false}
        try{
            $Branch=(& $Git.Source -C $Root branch --show-current 2>$null|Out-String).Trim();$Dirty=(& $Git.Source -C $Root status --porcelain=v1 --untracked-files=all 2>$null|Out-String).Trim();$Origin=(& $Git.Source -C $Root remote get-url origin 2>$null|Out-String).Trim()
            if($Branch-ne'main'-or$Dirty-or$Origin-notmatch'(?i)(github\.com[:/])EVAVO-STUDIO/evavo-local-storage(?:\.git)?$'){return$false}
            & $Git.Source -C $Root fetch --no-tags origin main 1>$null 2>$null;if($LASTEXITCODE-ne0){return$false}
            $Local=(& $Git.Source -C $Root rev-parse HEAD 2>$null|Out-String).Trim().ToLowerInvariant();$Remote=(& $Git.Source -C $Root rev-parse refs/remotes/origin/main 2>$null|Out-String).Trim().ToLowerInvariant()
            return[bool]($Local-match'^[a-f0-9]{40}$'-and$Local-eq$Remote)
        }catch{return$false}
    }
    if($LocalStorageRoot){if(-not(Test-AdmittedLocalStorageSource $LocalStorageRoot)){throw'EVAVO_REMOTE_MCP_RELAY_DEPLOY_V2_EXPLICIT_LOCAL_STORAGE_NOT_ADMITTED'};$SelectedLocalStorage=[IO.Path]::GetFullPath($LocalStorageRoot);$SelectedSourceCategory='explicit'}else{
        $GitRoot=if($env:EVAVO_GIT_ROOT){$env:EVAVO_GIT_ROOT}else{'C:\GitRepos'}
        $Candidates=@(
            @{path=(Join-Path $env:LOCALAPPDATA 'EVAVO\WorkerControlPlane\zero-cost-updater\runtime\evavo-local-storage');category='managed-updater'},
            @{path=(Join-Path $env:LOCALAPPDATA 'EVAVO\WorkerControlPlane\zero-cost-recovery\runtime\evavo-local-storage');category='managed-recovery'},
            @{path=(Join-Path $env:LOCALAPPDATA 'EVAVO\WorkerControlPlane\zero-cost-logon-guardian\runtime\evavo-local-storage');category='managed-logon-guardian'},
            @{path=(Join-Path $GitRoot 'evavo-local-storage');category='development-fallback'}
        )
        foreach($Candidate in $Candidates){if(Test-AdmittedLocalStorageSource ([string]$Candidate.path)){$SelectedLocalStorage=[IO.Path]::GetFullPath([string]$Candidate.path);$SelectedSourceCategory=[string]$Candidate.category;break}}
        if(-not$SelectedLocalStorage){throw'EVAVO_REMOTE_MCP_RELAY_DEPLOY_V2_NO_ADMITTED_LOCAL_STORAGE_SOURCE'}
    }
}

$Args=@{};if($RelayBaseUrl){$Args.RelayBaseUrl=$RelayBaseUrl};if($SelectedLocalStorage){$Args.LocalStorageRoot=$SelectedLocalStorage};if($SkipPackageInstall){$Args.SkipPackageInstall=$true};if($SkipWorkstationClientInstall){$Args.SkipWorkstationClientInstall=$true}
try{
    $Raw=(& $V1 @Args|Out-String).Trim();if(-not$Raw){throw'EVAVO_REMOTE_MCP_RELAY_DEPLOY_V2_RECEIPT_MISSING'};$V1Receipt=$Raw|ConvertFrom-Json -ErrorAction Stop
    if([int]$V1Receipt.schemaVersion-lt2-or[string]$V1Receipt.kind-ne'evavo-remote-mcp-relay-deployment'-or$V1Receipt.ok-ne$true-or$V1Receipt.workstationSecretReturned-ne$false-or$V1Receipt.dispatchSecretReturned-ne$false){throw'EVAVO_REMOTE_MCP_RELAY_DEPLOY_V2_RECEIPT_INVALID'}
    [ordered]@{schemaVersion=4;kind='evavo-remote-mcp-relay-deployment-v2';ok=$true;credentialSourceCategory=$CredentialSource;accountSourceCategory=$AccountSource;existingProviderCredentialReused=$true;compatibilityEnvAliasMapped=[bool]($MappedToken-or$MappedAccount);cloudflareCredentialValueReturned=$false;cloudflareAccountIdReturned=$false;credentialPersistedByThisWrapper=$false;localStorageSourceCategory=$SelectedSourceCategory;localStorageSourcePathReturned=$false;admittedLocalStorageSourceRequired=[bool](-not$SkipWorkstationClientInstall);relay=$V1Receipt;relayBaseUrl=[string]$V1Receipt.relayBaseUrl;mcpUrl=[string]$V1Receipt.mcpUrl;healthUrl=[string]$V1Receipt.healthUrl;workstationClientInstalled=[bool]$V1Receipt.workstationClientInstalled;physicalWorkstationConnectionProven=[bool]$V1Receipt.physicalWorkstationConnectionProven;workstationSecretReturned=$false;dispatchSecretReturned=$false;dispatchCallerCredentialProvisioned=[bool]$V1Receipt.dispatchCallerCredentialProvisioned;effectfulDispatchReadyForExternalCaller=[bool]$V1Receipt.effectfulDispatchReadyForExternalCaller;githubActionsRequired=$false;vercelRequired=$false;paidRelayRequired=$false}|ConvertTo-Json -Depth 14
}finally{if($MappedToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue};if($MappedAccount){Remove-Item Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue}}
