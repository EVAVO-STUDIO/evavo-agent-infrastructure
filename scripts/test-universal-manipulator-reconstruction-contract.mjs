#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.cwd());
const contractPath = path.join(root, "config", "universal-manipulator-reconstruction-contract-v1.json");
const detailedPath = path.join(root, "config", "universal-manipulator-reconstruction-v1.json");
const authoritiesPath = path.join(root, "config", "agent-capability-authorities-v1.json");
const contract = JSON.parse(await fs.readFile(contractPath, "utf8"));
const detailed = JSON.parse(await fs.readFile(detailedPath, "utf8"));
const authorities = JSON.parse(await fs.readFile(authoritiesPath, "utf8"));

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(contract.schemaVersion === 1, "unexpected schema version");
assert(contract.kind === "evavo-universal-manipulator-reconstruction-contract", "unexpected contract kind");
assert(contract.repository === "EVAVO-STUDIO/universal-manipulator", "canonical repository identity changed");
assert(contract.detailedSpecification === "config/universal-manipulator-reconstruction-v1.json", "detailed reconstruction contract drifted");
assert(contract.automaticActivationAuthorized === false, "automatic activation must remain disabled");
assert(contract.automaticPublicationAuthorized === false, "automatic publication must remain disabled");
assert(contract.automaticEnrollmentAuthorized === false, "automatic enrollment must remain disabled");
assert(contract.automaticGrantAuthorized === false, "automatic grant must remain disabled");
assert(contract.automaticHighImpactControlAuthorized === false, "automatic high-impact control must remain disabled");

for (const connectorId of [
  "home-assistant-local",
  "matter-local-fabric",
  "tuya-smart-life",
  "redfish-management",
  "profiled-local-protocols",
]) {
  assert(contract.plannedConnectorFamilies.some((entry) => entry.connectorId === connectorId), `missing connector family: ${connectorId}`);
}

for (const lifecycleStep of [
  "discover-without-trust",
  "review-enrollment",
  "grant-exact-operation",
  "request-workstation-command-reservation",
  "verify-sealed-interlock",
  "request-workstation-execution-claim-immediately-before-provider-contact",
  "consume-workstation-provider-dispatch-once",
  "read-back-postcondition",
  "block-automatic-retry-on-unknown-outcome",
]) {
  assert(contract.requiredCommandLifecycle.includes(lifecycleStep), `missing command lifecycle step: ${lifecycleStep}`);
}

assert(contract.mandatorySafetyInvariants?.unknownOutcomeBlocksRetry === true, "unknown outcome must block automatic retry");
assert(contract.mandatorySafetyInvariants?.sealedInterlockRequiredBeforeMutation === true, "sealed interlock must be required before mutation");
assert(contract.mandatorySafetyInvariants?.forbidEmbeddedCredentials === true, "embedded credentials must remain forbidden");
assert(contract.mandatorySafetyInvariants?.workstationClaimMayExecuteProvider === false, "workstation claim must not execute provider");
assert(contract.mandatorySafetyInvariants?.singleUseProviderDispatchRequired === true, "single-use provider dispatch must remain mandatory");
assert(contract.mandatorySafetyInvariants?.providerDispatchReplayAllowed === false, "provider dispatch replay must remain forbidden");
assert(contract.mandatorySafetyInvariants?.physicalAcceptanceAloneGrantsMutation === false, "physical acceptance alone must not grant mutation");
assert(contract.mandatorySafetyInvariants?.physicalAcceptanceAloneGrantsAutomaticExecution === false, "physical acceptance alone must not grant automatic execution");

for (const repository of [
  "EVAVO-STUDIO/evavo-workstation-manager",
  "EVAVO-STUDIO/network-studio",
  "EVAVO-STUDIO/evavo-local-ai-agent-gateway",
  "EVAVO-STUDIO/evavo-out-of-band-control",
  "EVAVO-STUDIO/evavo-computer-agent",
]) {
  assert(contract.mustNotOwn.some((entry) => entry.authority === repository), `missing authority boundary for ${repository}`);
}

assert(contract.workstationOwnedTransactionGates.includes("device-command-claim"), "Workstation Manager must retain execution claim authority");
assert(contract.workstationOwnedTransactionGates.includes("single-use-provider-dispatch-consumption"), "Workstation Manager must retain provider-dispatch consumption");
assert(contract.workstationOwnedTransactionGates.includes("physical-acceptance"), "Workstation Manager must retain physical acceptance");

assert(detailed.canonicalRepository === contract.repository, "compact and detailed repository identities disagree");
assert(detailed.status === "source-unresolved-reconstruction-approved", "detailed reconstruction must remain unresolved");
assert(detailed.integration.agentInfrastructureRouteEligibilityBeforeAcceptance === false, "reconstructed source must not become routable before acceptance");
assert(detailed.workstationTransactionDependency.rules.claimMayExecuteProvider === false, "detailed contract shifted provider execution into claim");

const authority = authorities["universal-manipulator"];
assert(authority, "canonical authority must remain reserved");
assert(authority.repository === contract.repository, "authority registry repository drifted");
assert(Array.isArray(authority.effects) && authority.effects.includes("control"), "control authority reservation missing");
assert(/not eligible/i.test(authority.description), "authority must remain explicitly ineligible while unresolved");

console.log("universal manipulator reconstruction contract: ok");
