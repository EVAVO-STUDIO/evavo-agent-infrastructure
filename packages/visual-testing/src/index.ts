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
  readonly version: "1.0.0";
  readonly campaignAuthority: "EVAVO-STUDIO/automated-testing";
  readonly computerUseAuthority: "EVAVO-STUDIO/evavo-computer-agent";
  readonly localInferenceAuthority: "EVAVO-STUDIO/evavo-local-compute";
  readonly modelLifecycleAuthority: "EVAVO-STUDIO/evavo-model-lab";
  readonly implementsBrowserWorker: false;
  readonly implementsComputerInput: false;
  readonly implementsVisualModelRuntime: false;
}

export function getVisualTestingRoute(): VisualTestingRoute {
  return {
    schema: VISUAL_TESTING_ROUTE_SCHEMA,
    version: "1.0.0",
    campaignAuthority: "EVAVO-STUDIO/automated-testing",
    computerUseAuthority: "EVAVO-STUDIO/evavo-computer-agent",
    localInferenceAuthority: "EVAVO-STUDIO/evavo-local-compute",
    modelLifecycleAuthority: "EVAVO-STUDIO/evavo-model-lab",
    implementsBrowserWorker: false,
    implementsComputerInput: false,
    implementsVisualModelRuntime: false,
  };
}
