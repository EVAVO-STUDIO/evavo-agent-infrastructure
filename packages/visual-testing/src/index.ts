/**
 * Thin visual-testing capability route for EVAVO agents.
 *
 * This package deliberately does not implement a second browser/QA engine.
 * Automated Testing owns campaigns, browser workers, evidence and findings.
 * EVAVO Computer Agent owns screen perception, grounding and UI input.
 * Agent Infrastructure only exposes where those capabilities live.
 */

export const VISUAL_TESTING_ROUTE_SCHEMA = "evavo.visual-testing-route.v1" as const;

export interface VisualTestingRoute {
  readonly schema: typeof VISUAL_TESTING_ROUTE_SCHEMA;
  readonly version: "1.1.0";
  readonly campaignAuthority: "EVAVO-STUDIO/automated-testing";
  readonly computerUseAuthority: "EVAVO-STUDIO/evavo-computer-agent";
  readonly localInferenceAuthority: "EVAVO-STUDIO/evavo-local-compute";
  readonly modelLifecycleAuthority: "EVAVO-STUDIO/evavo-model-lab";
  readonly computerAgentContracts: {
    readonly readiness: "evavo_computer_agent_capabilities_v2";
    readonly protocolCapabilities: "evavo.computer-agent.protocol-capabilities.v1";
    readonly toolSurface: "evavo.computer-agent.tool-surface.v1";
    readonly grounding: "evavo.computer-agent.grounding.v1";
    readonly elementEvidence: "evavo.computer-agent.element-evidence.v1";
  };
  readonly truth: {
    readonly protocolPresenceIsOperationReadiness: false;
    readonly toolSurfacePresenceIsRuntimeReadiness: false;
    readonly visualModelSourceIsExecutionProof: false;
  };
  readonly implementsBrowserWorker: false;
  readonly implementsComputerInput: false;
  readonly implementsVisualModelRuntime: false;
}

export function getVisualTestingRoute(): VisualTestingRoute {
  return {
    schema: VISUAL_TESTING_ROUTE_SCHEMA,
    version: "1.1.0",
    campaignAuthority: "EVAVO-STUDIO/automated-testing",
    computerUseAuthority: "EVAVO-STUDIO/evavo-computer-agent",
    localInferenceAuthority: "EVAVO-STUDIO/evavo-local-compute",
    modelLifecycleAuthority: "EVAVO-STUDIO/evavo-model-lab",
    computerAgentContracts: {
      readiness: "evavo_computer_agent_capabilities_v2",
      protocolCapabilities: "evavo.computer-agent.protocol-capabilities.v1",
      toolSurface: "evavo.computer-agent.tool-surface.v1",
      grounding: "evavo.computer-agent.grounding.v1",
      elementEvidence: "evavo.computer-agent.element-evidence.v1",
    },
    truth: {
      protocolPresenceIsOperationReadiness: false,
      toolSurfacePresenceIsRuntimeReadiness: false,
      visualModelSourceIsExecutionProof: false,
    },
    implementsBrowserWorker: false,
    implementsComputerInput: false,
    implementsVisualModelRuntime: false,
  };
}
