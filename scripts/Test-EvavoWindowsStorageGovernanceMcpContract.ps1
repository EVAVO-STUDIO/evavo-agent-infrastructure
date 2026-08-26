[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Server = Join-Path $Root 'mcp-server\windows-storage-governance-mcp.mjs'
if (-not (Test-Path -LiteralPath $Server -PathType Leaf)) { throw 'EVAVO_STORAGE_GOVERNANCE_MCP_SOURCE_MISSING' }
$Item = Get-Item -LiteralPath $Server -Force -ErrorAction Stop
if ($Item.PSIsContainer -or ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'EVAVO_STORAGE_GOVERNANCE_MCP_SOURCE_INVALID' }
$Text = Get-Content -LiteralPath $Server -Raw -Encoding UTF8

$Required = @(
    'const SERVER_VERSION = "1.2.0"',
    'EVAVO_LOCAL_COMPUTE_ROOT',
    'RECOVER-EVAVO-STORAGE-CURRENT.ps1',
    'Get-EvavoStorageExecutionControlPlaneStatus.ps1',
    'evavo_storage_execution_status',
    'executionStatusTool: "evavo_storage_execution_status"',
    'taskPresenceIsNotConsumerProof !== true',
    'freshHeartbeatAndSuccessfulTaskRunRequired !== true',
    'receipt.mutationPerformed !== false',
    'receipt.networkPerformed !== false',
    'receipt.providerMutationPerformed !== false',
    'evavo_storage_recovery_current',
    'preferredRecoveryTool: "evavo_storage_recovery_current"',
    'evavo-storage-current-recovery-v5',
    'receipt.unattended !== true',
    'receipt.guardianInstallationPerformed !== false',
    'receipt.storageRecoveryCurrentOperationRequired !== true',
    'receipt.singleImmediateStorageCycleOwner !== true',
    'receipt.googleCycleCompletedBeforeEstateCycle !== true',
    'receipt.duplicateForceCyclesPerformed !== false',
    'receipt.estateFreshReceiptProven !== true',
    'receipt.googleFreshReceiptProven !== true',
    'receipt.completeQuotaMeasurementRequiredForTargetClaim !== true',
    'receipt.driveLowerBoundMayTriggerReclaim !== true',
    'receipt.driveLowerBoundMayCertifyWholeAccountTarget !== false',
    'Number(receipt.googleCapacityBytes) !== 15_000_000_000',
    'Number(receipt.downloadsCapacityBytes) !== 150_000_000_000',
    'Number(receipt.gitReposPlanningCeilingBytes) !== 400_000_000_000',
    'Number(receipt.beeStationNominalCapacityBytes) !== 4_000_000_000_000',
    'Number(receipt.beeStationOperationalFullBytes) !== 3_500_000_000_000',
    'receipt.githubActionsRequired !== false',
    'receipt.vercelRequired !== false',
    'receipt.mailboxRequired !== false',
    'arbitraryCommandTextAccepted: false',
    'callerSelectedPathAccepted: false'
)
foreach ($Marker in $Required) {
    if (-not $Text.Contains($Marker)) { throw "EVAVO_STORAGE_GOVERNANCE_MCP_CONTRACT_MISSING:$Marker" }
}

$Forbidden = @(
    'child_process.exec(',
    'child_process.execSync(',
    'shell: true',
    'eval(',
    'new Function('
)
foreach ($Marker in $Forbidden) {
    if ($Text.Contains($Marker)) { throw "EVAVO_STORAGE_GOVERNANCE_MCP_FORBIDDEN_AUTHORITY:$Marker" }
}

[ordered]@{
    schemaVersion = 2
    kind = 'evavo-windows-storage-governance-mcp-contract-v2'
    ok = $true
    preferredRecoveryTool = 'evavo_storage_recovery_current'
    executionStatusTool = 'evavo_storage_execution_status'
    serializedCurrentRecoveryRequired = $true
    taskPresenceIsNotConsumerProof = $true
    freshHeartbeatAndSuccessfulTaskRunRequired = $true
    googleCapacityBytes = 15000000000L
    downloadsCapacityBytes = 150000000000L
    gitReposPlanningCeilingBytes = 400000000000L
    beeStationNominalCapacityBytes = 4000000000000L
    beeStationOperationalFullBytes = 3500000000000L
    completeQuotaMeasurementRequiredForTargetClaim = $true
    driveLowerBoundMayCertifyWholeAccountTarget = $false
    arbitraryCommandTextAccepted = $false
    callerSelectedPathAccepted = $false
    githubActionsRequired = $false
    vercelRequired = $false
} | ConvertTo-Json -Depth 6 -Compress
