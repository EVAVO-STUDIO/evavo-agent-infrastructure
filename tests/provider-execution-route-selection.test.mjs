import assert from "node:assert/strict";
import test from "node:test";

import {
  providerExecutionRouteSelectionSafetyContract,
  selectProviderExecutionRoute,
} from "../scripts/provider-execution-route-selection.mjs";

function providerPlan(status = "unrouted") {
  return {
    contract: "evavo_provider_execution_plan_v1",
    handoffId: "naomi-vercel-v2",
    descriptor: {
      actionKey: "vercel.desired-state.reconcile",
      providerKey: "vercel",
      capability: "vercel.configure",
      canonicalExecutionOwner: "EVAVO-STUDIO/evavo-development-studio",
      preferredRoute: "cloudflare-provider-mcp",
      fallbackRoutes: [
        "development-studio-vercel-mcp",
        "cloudflare-typed-relay",
        "github-issue-queue",
      ],
      desiredStateRef: "EVAVO-STUDIO/evavo-agent-infrastructure:config/vercel-provider-desired-state-v1.json",
      effect: "execute",
    },
    projection: {
      contract: "evavo_provider_execution_truth_v1",
      handoffId: "naomi-vercel-v2",
      providerKey: "vercel",
      action: "vercel.desired-state.reconcile",
      capability: "vercel.configure",
      desiredStateRef: "EVAVO-STUDIO/evavo-agent-infrastructure:config/vercel-provider-desired-state-v1.json",
      planningEvidenceIds: ["operations:obligation:naomi-domain"],
      canonicalExecutionOwner: "EVAVO-STUDIO/evavo-development-studio",
      route: null,
      requestId: null,
      jobId: null,
      idempotencyKey: "vercel:desired-state:naomis30th:v2",
      status,
      observedAt: "2026-09-19T03:00:00.000Z",
      routingEvidenceIds: [],
      admissionEvidenceIds: [],
      executionEvidenceIds: [],
      postconditionEvidenceIds: [],
      replaySafetyEvidenceIds: [],
      executionAttempted: false,
      postconditionVerified: false,
      providerReadbackVerified: false,
      automaticReplayAllowed: false,
      blocker: "executor_route_not_selected",
    },
  };
}

function capabilityPlan({ status = "ready", selected, candidates = [] } = {}) {
  return {
    schemaVersion: 1,
    kind: "evavo-agent-capability-route-plan-v1",
    planDigestSha256: "a".repeat(64),
    authority: {
      execution: false,
      sourceMutation: false,
      repositoryWrite: false,
      publication: false,
      providerMutation: false,
      credentialAccess: false,
    },
    decisions: [{
      capability: "vercel.configure",
      status,
      reason: status === "ready" ? "first-eligible-route" : "all-observed-routes-blocked",
      selected: selected ?? null,
      candidates,
    }],
  };
}

const cloud = {
  strategyId: "vercel-configure-provider-cloud",
  authority: "development-governance",
  authorityRepository: "EVAVO-STUDIO/evavo-development-studio",
  transport: "cloudflare-provider-mcp",
  failureDomain: "cloudflare-provider-plane",
  sharedDependencies: ["cloudflare-workers"],
  executorRepository: "EVAVO-STUDIO/evavo-agent-infrastructure",
  observedState: "transport_online",
  sourceRevision: "b".repeat(40),
  receiptId: "cloud-health:sha256:" + "c".repeat(64),
};

test("healthy cloud provider route becomes executor_selected, never admitted", () => {
  const result = selectProviderExecutionRoute({
    providerPlan: providerPlan(),
    capabilityPlan: capabilityPlan({ selected: cloud }),
    observedAt: "2026-09-19T03:30:00.000Z",
  });
  assert.equal(result.status, "executor_selected");
  assert.equal(result.selectedRoute, "cloudflare-provider-mcp");
  assert.equal(result.executorRepository, "EVAVO-STUDIO/evavo-agent-infrastructure");
  assert.equal(result.projection.status, "executor_selected");
  assert.equal(result.projection.route, "cloudflare-provider-mcp");
  assert.deepEqual(result.projection.admissionEvidenceIds, []);
  assert.equal(result.projection.executionAttempted, false);
  assert.ok(result.routingEvidenceIds.some((id) => id.startsWith("agent-infrastructure:routing-plan:")));
  assert.ok(result.routingEvidenceIds.some((id) => id.startsWith("route-readiness-receipt:")));
});

test("cloud outage can select durable issue queue without implying execution", () => {
  const queue = {
    ...cloud,
    strategyId: "vercel-configure-issue-queue",
    transport: "github-issue-queue",
    failureDomain: "github-issue-queue",
    executorRepository: "EVAVO-STUDIO/evavo-local-compute",
    observedState: "configured",
    receiptId: null,
  };
  const result = selectProviderExecutionRoute({
    providerPlan: providerPlan(),
    capabilityPlan: capabilityPlan({ selected: queue }),
    observedAt: "2026-09-19T03:31:00.000Z",
  });
  assert.equal(result.status, "executor_selected");
  assert.equal(result.selectedRoute, "github-issue-queue");
  assert.equal(result.projection.status, "executor_selected");
  assert.equal(result.projection.executionAttempted, false);
  assert.deepEqual(result.projection.admissionEvidenceIds, []);
});

test("no eligible route becomes blocked and preserves zero-effect semantics", () => {
  const result = selectProviderExecutionRoute({
    providerPlan: providerPlan(),
    capabilityPlan: capabilityPlan({
      status: "blocked",
      candidates: [
        { strategyId: "vercel-configure-provider-cloud", reason: "unhealthy" },
        { strategyId: "vercel-configure-chatgpt-relay", reason: "unhealthy" },
      ],
    }),
    observedAt: "2026-09-19T03:32:00.000Z",
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.selectedRoute, null);
  assert.equal(result.projection.status, "blocked");
  assert.match(result.projection.blocker, /route-selection-blocked/);
  assert.equal(result.providerSubmissionPerformed, false);
  assert.equal(result.externalEffectPerformed, false);
});

test("route selector rejects unregistered transports and authority drift", () => {
  assert.throws(() => selectProviderExecutionRoute({
    providerPlan: providerPlan(),
    capabilityPlan: capabilityPlan({ selected: { ...cloud, transport: "arbitrary-provider-proxy" } }),
    observedAt: "2026-09-19T03:33:00.000Z",
  }), /UNREGISTERED_TRANSPORT/);

  assert.throws(() => selectProviderExecutionRoute({
    providerPlan: providerPlan(),
    capabilityPlan: capabilityPlan({ selected: { ...cloud, authorityRepository: "EVAVO-STUDIO/other" } }),
    observedAt: "2026-09-19T03:33:00.000Z",
  }), /AUTHORITY_MISMATCH/);
});

test("route selection cannot overwrite queued or effectful state", () => {
  assert.throws(() => selectProviderExecutionRoute({
    providerPlan: providerPlan("queued"),
    capabilityPlan: capabilityPlan({ selected: cloud }),
    observedAt: "2026-09-19T03:34:00.000Z",
  }), /STATE_NOT_SELECTABLE/);
});

test("route selection safety contract keeps route evidence below admission", () => {
  assert.equal(providerExecutionRouteSelectionSafetyContract.capabilityPlanMustBeNoEffect, true);
  assert.equal(providerExecutionRouteSelectionSafetyContract.callerSelectedTransportAccepted, false);
  assert.equal(providerExecutionRouteSelectionSafetyContract.configuredEndpointAloneIsReadiness, false);
  assert.equal(providerExecutionRouteSelectionSafetyContract.routeSelectionIsAdmission, false);
  assert.equal(providerExecutionRouteSelectionSafetyContract.routeSelectionIsExecution, false);
  assert.equal(providerExecutionRouteSelectionSafetyContract.routingEvidenceSeparateFromAdmissionEvidence, true);
  assert.equal(providerExecutionRouteSelectionSafetyContract.providerSubmissionPerformed, false);
});
