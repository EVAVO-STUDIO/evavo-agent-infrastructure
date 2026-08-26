[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][Uri]$RelayBaseUrl,
    [Parameter(Mandatory=$true)][Security.SecureString]$DispatchToken,
    [Parameter(Mandatory=$true)]
    [ValidateSet('storage.status','storage.inventory.refresh','storage.google_pressure.activate','storage.estate.activate')]
    [string]$Action,
    [ValidateRange(10,900)][int]$TimeoutSeconds = 600,
    [ValidateRange(1,10)][int]$PollSeconds = 2
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'

if($RelayBaseUrl.Scheme-ne'https'-or$RelayBaseUrl.Query-or$RelayBaseUrl.Fragment){throw'EVAVO_REMOTE_STORAGE_DISPATCH_BASE_URL_INVALID'}
$Authority=$RelayBaseUrl.GetLeftPart([UriPartial]::Authority).TrimEnd('/')
$DispatchUri="$Authority/api/dispatch"

$Bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($DispatchToken)
$Plain=$null
$Headers=$null
try{
    $Plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
    if([string]::IsNullOrWhiteSpace($Plain)-or$Plain.Length-lt32){throw'EVAVO_REMOTE_STORAGE_DISPATCH_TOKEN_TOO_SHORT'}
    $Headers=@{Authorization="Bearer $Plain"}
    $Payload=[ordered]@{action=$Action;arguments=[ordered]@{};wait=$false;timeoutMs=[math]::Min(600000,$TimeoutSeconds*1000)}
    $Queued=Invoke-RestMethod -Method POST -Uri $DispatchUri -Headers $Headers -ContentType 'application/json' -Body ($Payload|ConvertTo-Json -Depth 5 -Compress) -TimeoutSec 30 -ErrorAction Stop
    if($Queued.ok-ne$true-or[string]$Queued.action-ne$Action-or[string]$Queued.status-ne'queued'-or[string]$Queued.id-notmatch'^[0-9a-fA-F-]{36}$'){throw'EVAVO_REMOTE_STORAGE_DISPATCH_QUEUE_RECEIPT_INVALID'}
    $RequestId=[string]$Queued.id
    $Deadline=[DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    $Final=$null
    do{
        Start-Sleep -Seconds $PollSeconds
        $Poll=Invoke-RestMethod -Method GET -Uri "$Authority/api/request?id=$RequestId" -Headers $Headers -TimeoutSec 30 -ErrorAction Stop
        if($Poll.ok-ne$true-or-not$Poll.request-or[string]$Poll.request.id-ne$RequestId-or[string]$Poll.request.action-ne$Action){throw'EVAVO_REMOTE_STORAGE_DISPATCH_POLL_RECEIPT_INVALID'}
        $State=[string]$Poll.request.status
        if($State-eq'completed'-or$State-eq'failed'){$Final=$Poll.request;break}
        if($State-ne'queued'){throw'EVAVO_REMOTE_STORAGE_DISPATCH_STATE_INVALID'}
    }while([DateTimeOffset]::UtcNow-lt$Deadline)
    if(-not$Final){throw'EVAVO_REMOTE_STORAGE_DISPATCH_TIMEOUT'}
    if([string]$Final.status-ne'completed'-or$Final.ok-ne$true){
        $Reason=if($Final.error){[string]$Final.error}else{'remote-storage-operation-failed'}
        throw"EVAVO_REMOTE_STORAGE_DISPATCH_FAILED:$Reason"
    }
    [ordered]@{
        schemaVersion=1
        kind='evavo-remote-storage-dispatch-receipt-v1'
        ok=$true
        completedAt=[DateTimeOffset]::UtcNow.ToString('o')
        requestId=$RequestId
        action=$Action
        transportQueued=$true
        correlatedCompletedResultObserved=$true
        physicalSuccessClaimed=$true
        result=$Final.result
        dispatchTokenReturned=$false
        dispatchTokenWrittenToDisk=$false
        dispatchTokenInCommandLine=$false
        arbitraryActionAccepted=$false
        arbitraryArgumentsAccepted=$false
        rawShellAccepted=$false
        githubActionsRequired=$false
        vercelRequired=$false
        paidRelayRequired=$false
    }|ConvertTo-Json -Depth 14
}
finally{
    if($Headers){$Headers.Authorization=$null;$Headers=$null}
    $Plain=$null
    if($Bstr-ne[IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)}
}
