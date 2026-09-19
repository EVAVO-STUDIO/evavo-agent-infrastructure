export const PROVIDER_EXECUTION_ROUTE_SELECTION_CONTRACT =
  "evavo-provider-execution-route-selection-v1";

const SELECTABLE_INPUT_STATES = new Set(["unrouted", "planned", "blocked", "failed"]);

function required(value, field, max = 1000) {
  const clean = typeof value === "string" ? value.trim() : "";
  if (!clean || clean.length > max || /[\u0000-\u001f\u007f]/u.test(clean)) {
    throw new Error(`EVAVO_PROVIDER_ROUTE_${field.toUpperCase()}_INVALID`);
  }
  return clean;
}

function iso(value, field) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`EVAVO_PROVIDER_ROUTE_${field.toUpperCase()}_INVALID`);
  return new Date(parsed).toISOString();
}

function strings(values, field, maximum = 16) {
  if (!Array.isArray(values) || values.length > maximum) {
    throw new Error(`EVAVO_PROVIDER_ROUTE_${field.toUpperCase()}_INVALID`);
  }
  return Object.freeze([...new Set(values.map((value) => required(value, field, 500)))]);
}

function baseProjection(plan) {
  const projection = plan?.projection;
  if (!projection || projection.contract !== "evavo_provider_execution_truth_v1") {
    throw new Error("EVAVO_PROVIDER_ROUTE_PROJECTION_CONTRACT_INVALID");
  }
  if (!SELECTABLE_INPUT_STATES.has(projection.status)) {
    throw new Error("EVAVO_PROVIDER_ROUTE_PROJECTION_STATE_NOT_SELECTABLE");
  }
  if (projection.executionAttempted !== false) {
    throw new Error("EVAVO_PROVIDER_ROUTE_EXECUTION_ALREADY_ATTEMPTED");
  }
  if ((projection.admissionEvidenceIds ?? []).length || (projection.executionEvidenceIds ?? []).length) {
    throw new Error("EVAVO_PROVIDER_ROUTE_EXECUTION_EVIDENCE_ALREADY_PRESENT");
  }
  return projection;
}

export function selectProviderExecutionRoute({ providerPlan, capabilityPlan, observedAt }) {
  if (providerPlan?.contract !== "evavo_provider_execution_plan_v1") {
    throw new Error("EVAVO_PROVIDER_ROUTE_PLAN_CONTRACT_INVALID");
  }
  const descriptor = providerPlan.descriptor;
  if (!descriptor || descriptor.effect !== "execute") {
    throw new Error("EVAVO_PROVIDER_ROUTE_DESCRIPTOR_INVALID");
  }
  const capability = required(descriptor.capability, "capability", 240);
  const owner = required(descriptor.canonicalExecutionOwner, "execution_owner", 240);
  const preferred = required(descriptor.preferredRoute, "preferred_route", 240);
  const fallbacks = strings(descriptor.fallbackRoutes ?? [], "fallback_routes");
  const allowedRoutes = new Set([preferred, ...fallbacks]);
  const desiredStateRef = required(descriptor.desiredStateRef, "desired_state_ref", 1000);
  const projection = baseProjection(providerPlan);

  if (projection.capability !== capability || projection.desiredStateRef !== desiredStateRef) {
    throw new Error("EVAVO_PROVIDER_ROUTE_PLAN_IDENTITY_MISMATCH");
  }
  if (projection.canonicalExecutionOwner !== owner) {
    throw new Error("EVAVO_PROVIDER_ROUTE_EXECUTION_OWNER_MISMATCH");
  }

  if (
    capabilityPlan?.kind !== "evavo-agent-capability-route-plan-v1" ||
    capabilityPlan?.authority?.execution !== false ||
    capabilityPlan?.authority?.providerMutation !== false ||
    capabilityPlan?.authority?.credentialAccess !== false
  ) {
    throw new Error("EVAVO_PROVIDER_ROUTE_CAPABILITY_PLAN_INVALID");
  }
  const planDigest = required(capabilityPlan.planDigestSha256, "plan_digest", 64);
  if (!/^[0-9a-f]{64}$/u.test(planDigest)) {
    throw new Error("EVAVO_PROVIDER_ROUTE_PLAN_DIGEST_INVALID");
  }

  const decisions = Array.isArray(capabilityPlan.decisions) ? capabilityPlan.decisions : [];
  const matches = decisions.filter((decision) => decision?.capability === capability);
  if (matches.length !== 1) throw new Error("EVAVO_PROVIDER_ROUTE_CAPABILITY_DECISION_INVALID");
  const decision = matches[0];
  const at = iso(observedAt, "observed_at");
  const routingEvidenceIds = [
    `agent-infrastructure:routing-plan:${planDigest}`,
  ];

  if (decision.status !== "ready" || !decision.selected) {
    const candidateReasons = Array.isArray(decision.candidates)
      ? decision.candidates
          .map((candidate) => `${candidate.strategyId}:${candidate.reason}`)
          .filter((value) => value.length <= 500)
      : [];
    return Object.freeze({
      contract: PROVIDER_EXECUTION_ROUTE_SELECTION_CONTRACT,
      handoffId: providerPlan.handoffId,
      capability,
      status: "blocked",
      selectedRoute: null,
      selectedStrategyId: null,
      executorRepository: null,
      routingEvidenceIds: Object.freeze(routingEvidenceIds),
      blocker: required(
        `route-selection-blocked:${decision.reason ?? "no-current-eligible-executor"}:${candidateReasons.join(",")}`,
        "blocker",
        1000,
      ),
      projection: Object.freeze({
        ...projection,
        route: null,
        requestId: null,
        jobId: null,
        status: "blocked",
        observedAt: at,
        routingEvidenceIds: Object.freeze(routingEvidenceIds),
        admissionEvidenceIds: Object.freeze([]),
        executionEvidenceIds: Object.freeze([]),
        postconditionEvidenceIds: Object.freeze([]),
        executionAttempted: false,
        postconditionVerified: false,
        providerReadbackVerified: false,
        automaticReplayAllowed: false,
        blocker: `route-selection-blocked:${decision.reason ?? "no-current-eligible-executor"}`,
      }),
      providerSubmissionPerformed: false,
      externalEffectPerformed: false,
    });
  }

  const selected = decision.selected;
  const route = required(selected.transport, "selected_route", 240);
  const authorityRepository = required(selected.authorityRepository, "authority_repository", 240);
  if (!allowedRoutes.has(route)) throw new Error("EVAVO_PROVIDER_ROUTE_UNREGISTERED_TRANSPORT");
  if (authorityRepository !== owner) throw new Error("EVAVO_PROVIDER_ROUTE_AUTHORITY_MISMATCH");
  if (selected.receiptId) routingEvidenceIds.push(`route-readiness-receipt:${required(selected.receiptId, "receipt_id", 256)}`);

  return Object.freeze({
    contract: PROVIDER_EXECUTION_ROUTE_SELECTION_CONTRACT,
    handoffId: providerPlan.handoffId,
    capability,
    status: "executor_selected",
    selectedRoute: route,
    selectedStrategyId: required(selected.strategyId, "strategy_id", 240),
    executorRepository: selected.executorRepository ?? null,
    routingEvidenceIds: Object.freeze(routingEvidenceIds),
    blocker: null,
    projection: Object.freeze({
      ...projection,
      route,
      requestId: null,
      jobId: null,
      status: "executor_selected",
      observedAt: at,
      routingEvidenceIds: Object.freeze(routingEvidenceIds),
      admissionEvidenceIds: Object.freeze([]),
      executionEvidenceIds: Object.freeze([]),
      postconditionEvidenceIds: Object.freeze([]),
      executionAttempted: false,
      postconditionVerified: false,
      providerReadbackVerified: false,
      automaticReplayAllowed: false,
      blocker: null,
    }),
    providerSubmissionPerformed: false,
    externalEffectPerformed: false,
  });
}

export const providerExecutionRouteSelectionSafetyContract = Object.freeze({
  capabilityPlanMustBeNoEffect: true,
  canonicalExecutionOwnerMustMatch: true,
  registeredTransportOnly: true,
  callerSelectedTransportAccepted: false,
  configuredEndpointAloneIsReadiness: false,
  routeSelectionIsAdmission: false,
  routeSelectionIsExecution: false,
  routeSelectionIsCompletion: false,
  routingEvidenceSeparateFromAdmissionEvidence: true,
  unknownEffectAutomaticReplayAllowed: false,
  providerSubmissionPerformed: false,
});
