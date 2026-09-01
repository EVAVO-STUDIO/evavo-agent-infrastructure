#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const files = {
  policy: "config/codex-documentation-truth-dormant-fixture-campaign-v1.json",
  adapter: "config/codex-worker-adapter-v1.json",
  runner: "scripts/run-codex-documentation-truth-dormant-fixture-campaign.mjs",
  tests: "scripts/test-codex-documentation-truth-dormant-fixture-campaign.mjs",
  campaignSchema: "schemas/codex-documentation-truth-dormant-fixture-campaign-v1.schema.json",
  scenarioSchema: "schemas/codex-documentation-truth-dormant-fixture-scenario-v1.schema.json",
  supervisionSchema: "schemas/codex-documentation-truth-dormant-fixture-supervision-v1.schema.json",
};
const errors = [];

function read(relativePath) {
  if (!fs.existsSync(relativePath)) {
    errors.push(`Required documentation-truth campaign file is missing: ${relativePath}`);
    return "";
  }
  const stat = fs.lstatSync(relativePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    errors.push(`Required documentation-truth campaign file is unsafe: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(relativePath, "utf8");
}

const source = Object.fromEntries(Object.entries(files).map(([key, value]) => [key, read(value)]));
const json = {};
for (const key of ["policy", "adapter", "campaignSchema", "scenarioSchema", "supervisionSchema"]) {
  try { json[key] = JSON.parse(source[key]); }
  catch (error) { errors.push(`${files[key]} is invalid JSON: ${error?.message ?? error}`); }
}

const policy = json.policy ?? {};
if (
  policy.schemaVersion !== 1 ||
  policy.kind !== "evavo-codex-documentation-truth-dormant-fixture-campaign-policy-v1" ||
  policy.owner !== "EVAVO-STUDIO/evavo-agent-infrastructure" ||
  policy.routeId !== "codex-spark-pro" ||
  policy.modelPreference !== "gpt-5.3-codex-spark" ||
  policy.capacityClass !== "included-consumer" ||
  policy.authenticationClass !== "chatgpt-consumer" ||
  policy.workerClass !== "documentation-truth" ||
  policy.workClass !== "capability-manifest-maintenance" ||
  policy.sandboxMode !== "workspace-write" ||
  policy.approvalPolicy !== "never" ||
  policy.maximumChangedFiles !== 1 ||
  policy.maximumChangedLines !== 600 ||
  policy.maximumScenarioSeconds !== 1200 ||
  policy.maximumCampaignSeconds !== 3600
) errors.push("Documentation-truth dormant fixture campaign policy identity is invalid.");
if (
  JSON.stringify([...(policy.allowedManifestPaths ?? [])].sort()) !==
    JSON.stringify([".evavo/capabilities.json", "evavo.capabilities.json"]) ||
  JSON.stringify([...(policy.requiredScenarios ?? [])].sort()) !==
    JSON.stringify([
      "forbidden-path-rejection",
      "stale-head-rejection",
      "validated-no-action",
      "validated-success",
    ]) ||
  JSON.stringify([...(policy.modelScenarios ?? [])].sort()) !==
    JSON.stringify(["validated-no-action", "validated-success"]) ||
  JSON.stringify([...(policy.deterministicRejectionScenarios ?? [])].sort()) !==
    JSON.stringify(["forbidden-path-rejection", "stale-head-rejection"])
) errors.push("Documentation-truth campaign path or scenario scope is invalid.");
for (const [name, value] of Object.entries(policy.authority ?? {})) {
  if (value !== false) errors.push(`Documentation-truth campaign must keep authority.${name}=false.`);
}
if (
  policy.environment?.explicitEnableVariable !== "EVAVO_DOCUMENTATION_TRUTH_FIXTURE_CAMPAIGN_ENABLED" ||
  policy.environment?.requiredEnableValue !== "1" ||
  !Array.isArray(policy.environment?.apiKeyAndProviderVariablesRemoved) ||
  !policy.environment.apiKeyAndProviderVariablesRemoved.includes("OPENAI_API_KEY") ||
  !policy.environment.apiKeyAndProviderVariablesRemoved.includes("CODEX_API_KEY") ||
  !policy.environment.apiKeyAndProviderVariablesRemoved.includes("OPENAI_BASE_URL")
) errors.push("Documentation-truth campaign environment boundary is incomplete.");
if (
  policy.supervision?.fixtureOnly !== true ||
  policy.supervision?.fixtureRepositoryRemoteCount !== 0 ||
  policy.supervision?.fixtureMainMustRemainUnchanged !== true ||
  policy.supervision?.primaryCheckoutMustRemainClean !== true ||
  policy.supervision?.candidateCleanupRequired !== true ||
  policy.supervision?.registeredWorktreesAfterCleanup !== 1 ||
  policy.supervision?.normalRouteMutationAllowed !== false ||
  policy.supervision?.workerCommitAllowed !== false ||
  policy.supervision?.productRepositoryTouchAllowed !== false
) errors.push("Documentation-truth campaign supervision boundary is invalid.");

const adapter = json.adapter ?? {};
if (
  adapter.schemaVersion !== 1 || adapter.kind !== "evavo-codex-worker-adapter-v1" ||
  adapter.runtime !== "codex" || adapter.executable !== "codex" ||
  adapter.dispatch?.sandboxMode !== policy.sandboxMode ||
  adapter.dispatch?.approvalPolicy !== policy.approvalPolicy ||
  adapter.dispatch?.paidFallbackAllowed !== false
) errors.push("Codex adapter differs from the documentation-truth campaign policy.");

for (const key of ["campaignSchema", "scenarioSchema", "supervisionSchema"]) {
  const schema = json[key] ?? {};
  if (
    schema.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
    schema.type !== "object" || schema.additionalProperties !== false
  ) errors.push(`${files[key]} must be a closed Draft 2020-12 object.`);
}
for (const field of [
  "productRepositoryTouched",
  "normalRouteMutationPerformed",
  "workerCommitPerformed",
  "pushPerformed",
  "publicationPerformed",
  "deploymentPerformed",
  "financialActionPerformed",
  "paidFallbackUsed",
]) {
  if (json.campaignSchema?.properties?.[field]?.const !== false) {
    errors.push(`Campaign schema must keep ${field}=false.`);
  }
}
if (
  json.scenarioSchema?.properties?.designSha256 === undefined ||
  json.scenarioSchema?.properties?.agentInfrastructureMainSha === undefined ||
  json.scenarioSchema?.properties?.localStorageMainSha === undefined ||
  json.scenarioSchema?.properties?.observedAt === undefined ||
  json.supervisionSchema?.properties?.designSha256 === undefined ||
  json.supervisionSchema?.properties?.agentInfrastructureMainSha === undefined ||
  json.supervisionSchema?.properties?.localStorageMainSha === undefined ||
  json.supervisionSchema?.properties?.scenarioReceiptSha256 === undefined
) errors.push("Campaign receipt schemas lack exact source, design, freshness or scenario binding.");

function requireTokens(label, text, tokens) {
  for (const token of tokens) if (!text.includes(token)) errors.push(`${label} is missing token: ${token}`);
}
function forbidTokens(label, text, tokens) {
  for (const token of tokens) if (text.includes(token)) errors.push(`${label} contains forbidden token: ${token}`);
}

requireTokens("Documentation-truth campaign runner", source.runner, [
  "runCodexDocumentationTruthDormantFixtureCampaign",
  "defaultCodexExecutor",
  "EVAVO_DOCUMENTATION_TRUTH_FIXTURE_CAMPAIGN_ENABLED",
  "apiKeyAndProviderVariablesRemoved",
  "remote-less documentation truth fixture",
  "git(repository, [\"init\", \"-b\", \"main\"]",
  "git(repository, [\"worktree\", \"add\", \"--detach\"",
  "git(repository, [\"worktree\", \"remove\", \"--force\"",
  "git(repository, [\"worktree\", \"prune\", \"--expire\", \"now\"]",
  "fixtureRepositoryRemoteCount",
  "registeredWorktreesAfterCleanup",
  "validated-success",
  "validated-no-action",
  "FORBIDDEN_PATH",
  "STALE_HEAD",
  "modelTurnPerformed: false",
  "candidateMutationPersisted: false",
  "productRepositoryTouched: false",
  "normalRouteMutationPerformed: false",
  "workerCommitPerformed: false",
  "pushPerformed: false",
  "publicationPerformed: false",
  "paidFallbackUsed: false",
  "shell: false",
]);
requireTokens("Documentation-truth campaign tests", source.tests, [
  "success and NO_ACTION use an injected process boundary in a remote-less fixture repository",
  "forbidden-path and stale-head rejection occur without model execution",
  "cleanup proves unchanged clean main, zero remotes and one registered worktree",
  "stale capability, dormant-policy drift, path escape, invalid summaries and hidden mutation fail closed",
  "success-forbidden-path",
  "no-action-mutates",
  "malformed-success-summary",
  "FIXTURE_CAMPAIGN_ENABLED=1 is required",
]);
forbidTokens("Documentation-truth campaign runner", source.runner, [
  "C:\\GitRepos",
  "git push",
  "git remote add",
  "mainline-publish",
  "run-codex-worker-dispatch.mjs",
  "EVAVO_CODEX_SPARK_EXECUTION_ENABLED=1",
  "shell: true",
]);

for (const relativePath of [files.runner, files.tests, "scripts/check-codex-documentation-truth-dormant-fixture-campaign-contract.mjs"]) {
  const syntax = spawnSync(process.execPath, ["--check", relativePath], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
  });
  if (syntax.status !== 0) {
    errors.push(`${relativePath} failed Node syntax validation: ${String(syntax.stderr || syntax.stdout).trim()}`);
  }
}

if (errors.length === 0) {
  const tests = spawnSync(process.execPath, [files.tests], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: process.env.PATH ?? "",
      PATHEXT: process.env.PATHEXT ?? "",
      SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      WINDIR: process.env.WINDIR ?? "",
      HOME: process.env.HOME ?? "",
      USERPROFILE: process.env.USERPROFILE ?? "",
    },
  });
  if (tests.status !== 0) {
    errors.push(`${files.tests} failed: ${String(tests.stderr || tests.stdout).trim()}`);
  }
}

if (errors.length > 0) {
  console.error("Documentation-truth dormant fixture campaign contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Documentation-truth dormant fixture campaign contract passed.");
console.log("- injected tests prove the source-bound success, NO_ACTION and rejection semantics without a real model turn");
console.log("- the physical CLI remains explicitly gated and strips provider/API override variables");
console.log("- only a new remote-less fixture repository and external evidence directory may be mutated");
console.log("- product repositories, normal routes, commit/push publication and paid fallback remain outside authority");
