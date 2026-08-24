[CmdletBinding()]
param(
    [switch]$IncludeOperatorExecution,
    [switch]$IncludeWorkstationAcceptance,
    [ValidateRange(30,900)][int]$TimeoutSeconds = 420
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ($env:OS -ne 'Windows_NT') { throw 'EVAVO Local Agent MCP acceptance targets Windows only.' }
if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required.' }

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$Runtime = Join-Path $Root 'mcp-server\local-agent-mcp.mjs'
if (-not (Test-Path -LiteralPath $Runtime -PathType Leaf)) { throw 'Local Agent MCP runtime is missing.' }
$RuntimeItem = Get-Item -LiteralPath $Runtime -Force -ErrorAction Stop
if (($RuntimeItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Local Agent MCP runtime may not be a reparse point.' }

$Node = $null
foreach($Name in @('node.exe','node')) {
    $Candidate = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if($Candidate){$Node=[string]$Candidate.Source;break}
}
if(-not$Node){throw'Node.js is required for Local Agent MCP acceptance.'}
$NodeItem=Get-Item -LiteralPath $Node -Force -ErrorAction Stop
if(($NodeItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw'Local Agent MCP Node executable may not be a reparse point.'}

$RequiredTools=@(
    'evavo_local_agent_capabilities',
    'evavo_local_agent_action',
    'evavo_local_file_list',
    'evavo_local_file_copy',
    'evavo_local_operator_execute'
)
$Requests=[System.Collections.Generic.List[string]]::new()
function Add-Request($Value){$Requests.Add(($Value|ConvertTo-Json -Compress -Depth 20))}
Add-Request ([ordered]@{jsonrpc='2.0';id=1;method='initialize';params=[ordered]@{protocolVersion='2024-11-05';capabilities=@{};clientInfo=[ordered]@{name='evavo-mcp-acceptance';version='1.0.0'}}})
Add-Request ([ordered]@{jsonrpc='2.0';method='notifications/initialized'})
Add-Request ([ordered]@{jsonrpc='2.0';id=2;method='tools/list'})
Add-Request ([ordered]@{jsonrpc='2.0';id=3;method='tools/call';params=[ordered]@{name='evavo_local_agent_capabilities';arguments=@{}}})
Add-Request ([ordered]@{jsonrpc='2.0';id=4;method='tools/call';params=[ordered]@{name='evavo_local_agent_action';arguments=[ordered]@{action='local-first-status'}}})
if($IncludeWorkstationAcceptance){
    Add-Request ([ordered]@{jsonrpc='2.0';id=5;method='tools/call';params=[ordered]@{name='evavo_local_agent_action';arguments=[ordered]@{action='workstation-acceptance'}}})
}
if($IncludeOperatorExecution){
    $OperatorCases=@(
        [ordered]@{id=10;type='powershell';marker='EVAVO_MCP_POWERSHELL_OK';command="Write-Output 'EVAVO_MCP_POWERSHELL_OK'"},
        [ordered]@{id=11;type='python';marker='EVAVO_MCP_PYTHON_OK';command="print('EVAVO_MCP_PYTHON_OK')"},
        [ordered]@{id=12;type='bash';marker='EVAVO_MCP_BASH_OK';command="printf 'EVAVO_MCP_BASH_OK\\n'"},
        [ordered]@{id=13;type='cmd';marker='EVAVO_MCP_CMD_OK';command='echo EVAVO_MCP_CMD_OK'}
    )
    foreach($Case in $OperatorCases){
        Add-Request ([ordered]@{jsonrpc='2.0';id=$Case.id;method='tools/call';params=[ordered]@{name='evavo_local_operator_execute';arguments=[ordered]@{commandType=$Case.type;command=$Case.command;cwdRoot='gitrepos';cwdRelative='.';timeoutSeconds=30}}})
    }
}

$WorkRoot=Join-Path $env:LOCALAPPDATA 'EVAVO\AgentMcp043'
$ReceiptRoot=Join-Path $WorkRoot 'receipts'
New-Item -ItemType Directory -Path $ReceiptRoot -Force|Out-Null
foreach($Path in @($WorkRoot,$ReceiptRoot)){
    $Item=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if(-not$Item.PSIsContainer-or($Item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw'MCP acceptance state roots must be canonical non-reparse directories.'}
}
$Input=[IO.Path]::GetTempFileName();$Output=[IO.Path]::GetTempFileName();$Error=[IO.Path]::GetTempFileName()
$Started=[DateTimeOffset]::UtcNow
try{
    [IO.File]::WriteAllText($Input,(($Requests -join [Environment]::NewLine)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
    $Process=Start-Process -FilePath $Node -ArgumentList @($Runtime) -NoNewWindow -PassThru -RedirectStandardInput $Input -RedirectStandardOutput $Output -RedirectStandardError $Error
    if(-not$Process.WaitForExit($TimeoutSeconds*1000)){
        try{& taskkill.exe /PID $Process.Id /T /F 2>$null|Out-Null}catch{try{$Process.Kill()}catch{}}
        throw'Local Agent MCP acceptance timed out.'
    }
    $Stderr=if(Test-Path -LiteralPath $Error){Get-Content -LiteralPath $Error -Raw -Encoding UTF8}else{''}
    if($Process.ExitCode-ne0){throw"Local Agent MCP runtime exited $($Process.ExitCode)."}
    if(-not[string]::IsNullOrWhiteSpace($Stderr)){throw'Local Agent MCP runtime wrote unexpected stderr.'}
    $Responses=@()
    foreach($Line in @(Get-Content -LiteralPath $Output -Encoding UTF8)){
        if([string]::IsNullOrWhiteSpace($Line)){continue}
        try{$Responses+=($Line|ConvertFrom-Json -ErrorAction Stop)}catch{throw'Local Agent MCP runtime returned non-JSON stdout.'}
    }

    $Initialize=$Responses|Where-Object{$_.id-eq1}|Select-Object -First 1
    if([string]$Initialize.result.serverInfo.name-ne'evavo-agent-mcp'){throw'Local Agent MCP server identity mismatch.'}
    $List=$Responses|Where-Object{$_.id-eq2}|Select-Object -First 1
    $Observed=@($List.result.tools|ForEach-Object{[string]$_.name})
    foreach($Tool in $RequiredTools){if($Observed-notcontains$Tool){throw"Local Agent MCP missing required tool: $Tool"}}
    if((@($Observed|Select-Object -Unique)).Count-ne$Observed.Count){throw'Local Agent MCP tool inventory contains duplicates.'}

    function Read-ToolPayload([int]$Id){
        $Response=$Responses|Where-Object{$_.id-eq$Id}|Select-Object -First 1
        if(-not$Response){throw"Missing MCP response id $Id."}
        if($Response.result.isError-eq$true){throw"MCP tool call $Id reported an error."}
        $Text=[string](@($Response.result.content|Where-Object{$_.type-eq'text'}|Select-Object -First 1).text)
        if([string]::IsNullOrWhiteSpace($Text)){throw"MCP tool call $Id returned no text payload."}
        try{return$Text|ConvertFrom-Json -ErrorAction Stop}catch{throw"MCP tool call $Id returned invalid JSON payload."}
    }
    $Capabilities=Read-ToolPayload 3
    if($Capabilities.ok-ne$true-or$Capabilities.projectionSelfHashVerified-ne$true-or$Capabilities.externalNetworkPerformed-ne$false){throw'Local Agent MCP capability admission failed.'}
    $Status=Read-ToolPayload 4
    if($Status.ok-ne$true-or$Status.localAgentReady-ne$true){throw'Local Agent MCP typed local-first-status did not prove readiness.'}

    $WorkstationAcceptanceOk=$null
    if($IncludeWorkstationAcceptance){
        $Workstation=Read-ToolPayload 5
        $WorkstationAcceptanceOk=[bool]($Workstation.ok-eq$true)
        if(-not$WorkstationAcceptanceOk){throw'Local Agent MCP workstation acceptance failed.'}
    }

    $OperatorProof=@{}
    if($IncludeOperatorExecution){
        foreach($Case in $OperatorCases){
            $Payload=Read-ToolPayload ([int]$Case.id)
            $Stdout=[string]$Payload.stdout
            $Passed=[bool]($Payload.ok-eq$true-and$Payload.operatorAuthority-eq$true-and$Payload.shellParameterUsed-eq$false-and$Stdout.Contains([string]$Case.marker))
            $OperatorProof[[string]$Case.type]=$Passed
            if(-not$Passed){throw"Local Agent MCP operator probe failed: $($Case.type)"}
        }
    }

    $Receipt=[ordered]@{
        schemaVersion=1
        kind='evavo-local-agent-mcp-physical-acceptance-043-v1'
        ok=$true
        completedAt=[DateTimeOffset]::UtcNow.ToString('O')
        runtimeIdentity='evavo-agent-mcp'
        requiredToolCount=$RequiredTools.Count
        requiredTools=$RequiredTools
        toolInventoryProven=$true
        capabilityProjectionSelfHashProven=$true
        typedLocalAgentStatusProven=$true
        workstationAcceptanceRequested=[bool]$IncludeWorkstationAcceptance
        workstationAcceptanceProven=$WorkstationAcceptanceOk
        operatorExecutionRequested=[bool]$IncludeOperatorExecution
        powershellProven=if($IncludeOperatorExecution){[bool]$OperatorProof.powershell}else{$null}
        pythonProven=if($IncludeOperatorExecution){[bool]$OperatorProof.python}else{$null}
        bashProven=if($IncludeOperatorExecution){[bool]$OperatorProof.bash}else{$null}
        cmdProven=if($IncludeOperatorExecution){[bool]$OperatorProof.cmd}else{$null}
        operatorExecutionRequiresExplicitLocalEnable=$true
        externalNetworkRequiredForMcp=$false
        githubActionsRequired=$false
        credentialValuesReturned=$false
        physicalPathsReturned=$false
        forcePush=$false
        permanentDelete=$false
    }
    $ReceiptPath=Join-Path $ReceiptRoot ("$([DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))-$([Guid]::NewGuid().ToString('N')).json")
    $Bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Receipt|ConvertTo-Json -Depth 12)+[Environment]::NewLine)
    try{$Stream=[IO.File]::Open($ReceiptPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);try{$Stream.Write($Bytes,0,$Bytes.Length);$Stream.Flush($true)}finally{$Stream.Dispose()}}finally{[Array]::Clear($Bytes,0,$Bytes.Length)}
    $Receipt|ConvertTo-Json -Depth 12
    exit 0
} finally {
    Remove-Item -LiteralPath $Input,$Output,$Error -Force -ErrorAction SilentlyContinue
}
