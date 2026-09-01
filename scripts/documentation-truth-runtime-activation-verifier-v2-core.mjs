#!/usr/bin/env node

import { verifyDocumentationTruthRuntimeActivationGrant as verifyLegacyGrant } from "./documentation-truth-runtime-activation-verifier-core.mjs";
import { validateDocumentationTruthRuntimeGrantRequestIdentity } from "./documentation-truth-runtime-request-integrity.mjs";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}

export async function verifyDocumentationTruthRuntimeActivationGrantV2({
  envelope,
  request,
  trustAnchor,
  now = new Date(),
  consumedUses = 0,
}) {
  const requestIntegrity = validateDocumentationTruthRuntimeGrantRequestIdentity(request);
  const verified = await verifyLegacyGrant({
    envelope,
    request,
    trustAnchor,
    now,
    consumedUses,
  });
  if (verified.requestSha256 !== requestIntegrity.requestSha256) {
    throw new Error("Runtime activation verification request SHA-256 differs from exact request integrity.");
  }
  if (verified.grantBodySha256 !== requestIntegrity.grantBodySha256) {
    throw new Error("Runtime activation verification body SHA-256 differs from exact request integrity.");
  }
  return deepFreeze({
    ...verified,
    exactRequestIdentityVerified: true,
  });
}

export const DOCUMENTATION_TRUTH_RUNTIME_ACTIVATION_VERIFIER_V2_CONTRACT = deepFreeze({
  version: 2,
  exactRequestIdentityRequired: true,
  legacyCryptographicVerifierReused: true,
  privateKeyAuthority: false,
  signatureAuthority: false,
  grantConsumptionAuthority: false,
  capacitySelectionAuthority: false,
  queueMutationAuthority: false,
  leaseAuthority: false,
  modelAuthority: false,
  repositoryMutationAuthority: false,
  publicationAuthority: false,
});
