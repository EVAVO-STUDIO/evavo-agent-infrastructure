#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.cwd());
const contractPath = path.join(
  root,
  "config",
  "universal-manipulator-reconstruction-contract-v1.json",
);
const contract = JSON.parse(await fs.readFile(contractPath, "utf8"));

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(contract.schemaVersion === 1, "unexpected schema version");
assert(
  contract.kind === "evavo-universal-manipulator-reconstruction-contract",
  "unexpected contract kind",
);
assert(
  contract.repository === "EVAVO-STUDIO/universal-manipulator",
  "canonical repository identity changed",
);
assert(contract.automaticActivationAuthorized === false, "automatic activation must remain disabled");
assert(contract.automaticPublicationAuthorized === false, "automatic publication must remain disabled");
assert(contract.automaticEnrollmentAuthorized === false, "automatic enrollment must remain disabled");
assert(contract.automaticGrantAuthorized === false, "automatic grant must remain disabled");
assert(
  contract.automaticHighImpactControlAuthorized === false,
  "automatic high-impact control must remain disabled",
);

for (const connectorId of [
  "home-assistant-local",
  "matter-local-fabric",
  "tuya-smart-life",
  "redfish-management",
  "profiled-local-protocols",
]) {
  assert(
    contract.plannedConnectorFamilies.some((entry) => entry.connectorId === connectorId),
    `missing connector family: ${connectorId}`,
  );
}

for (const lifecycleStep of [
  "discover-without-trust",
  "review-enrollment",
  "grant-exact-operation",
  "reserve-command-intent",
  "verify-sealed-interlock",
  "claim-execution-immediately-before-provider-contact",
  "read-back-postcondition",
  "block-automatic-retry-on-unknown-outcome",
]) {
  assert(
    contract.requiredCommandLifecycle.includes(lifecycleStep),
    `missing command lifecycle step: ${lifecycleStep}`,
  );
}

assert(
  contract.mandatorySafetyInvariants?.unknownOutcomeBlocksRetry === true,
  "unknown outcome must block automatic retry",
);
assert(
  contract.mandatorySafetyInvariants?.sealedInterlockRequiredBeforeMutation === true,
  "sealed interlock must be required before mutation",
);
assert(
  contract.mandatorySafetyInvariants?.forbidEmbeddedCredentials === true,
  "embedded credentials must remain forbidden",
);

for (const repository of [
  "EVAVO-STUDIO/evavo-workstation-manager",
  "EVAVO-STUDIO/network-studio",
  "EVAVO-STUDIO/evavo-local-ai-agent-gateway",
  "EVAVO-STUDIO/evavo-out-of-band-control",
  "EVAVO-STUDIO/evavo-computer-agent",
]) {
  assert(
    contract.mustNotOwn.some((entry) => entry.authority === repository),
    `missing authority boundary for ${repository}`,
  );
}

console.log("universal manipulator reconstruction contract: ok");
