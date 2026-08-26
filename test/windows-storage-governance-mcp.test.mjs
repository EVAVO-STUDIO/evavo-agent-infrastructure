import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../mcp-server/windows-storage-governance-mcp.mjs", import.meta.url), "utf8");

test("storage governance MCP stays fixed, V5-aware and zero-hosted", () => {
  for (const token of [
    "evavo_storage_governance_doctor",
    "evavo_storage_governance_status",
    "evavo_storage_estate_activate",
    "evavo_google_storage_pressure_activate",
    "Get-EvavoStorageEstateStatus.ps1",
    "Invoke-EvavoStorageEstateRestExecutor.ps1",
    "Install-GoogleStoragePressureTaskCurrent.ps1",
    "evavo-storage-estate-status-v5",
    "evavo-storage-estate-rest-executor-activation-v2",
    "evavo-google-storage-pressure-current-installation-v1",
    "15_000_000_000",
    "150_000_000_000",
    "400_000_000_000",
    "4_000_000_000_000",
    "3_500_000_000_000",
    "500_000_000_000",
    "googleTargetBasisPoints: 7500",
    "downloadsTargetBasisPoints: 7000",
    "arbitraryCommandTextAccepted: false",
    "callerSelectedPathAccepted: false",
    "githubActionsRequired: false",
    "vercelRequired: false",
  ]) assert.ok(source.includes(token), `missing ${token}`);

  assert.ok(source.includes("Number(receipt.targetBasisPoints) !== 7500"));
  assert.ok(source.includes("Number(receipt.fallbackQuotaLimitBytes) !== 15_000_000_000"));
  assert.ok(source.includes("receipt.overQuotaTriggersReclaim !== true"));
  assert.ok(source.includes("receipt.archiveBeforeReclaimRequired !== true"));
  assert.ok(!source.includes("targetAtBasisPoints"));
  assert.ok(!source.includes("githubActionsRequired: true"));
});
