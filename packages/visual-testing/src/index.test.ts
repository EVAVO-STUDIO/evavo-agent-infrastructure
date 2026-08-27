import { describe, expect, it } from "vitest";
import { getVisualTestingRoute, VISUAL_TESTING_ROUTE_SCHEMA } from "./index.js";

describe("visual testing route", () => {
  it("routes specialist authority without implementing a duplicate runtime", () => {
    const route = getVisualTestingRoute();
    expect(route.schema).toBe(VISUAL_TESTING_ROUTE_SCHEMA);
    expect(route.version).toBe("1.1.0");
    expect(route.campaignAuthority).toBe("EVAVO-STUDIO/automated-testing");
    expect(route.computerUseAuthority).toBe("EVAVO-STUDIO/evavo-computer-agent");
    expect(route.localInferenceAuthority).toBe("EVAVO-STUDIO/evavo-local-compute");
    expect(route.modelLifecycleAuthority).toBe("EVAVO-STUDIO/evavo-model-lab");
    expect(route.implementsBrowserWorker).toBe(false);
    expect(route.implementsComputerInput).toBe(false);
    expect(route.implementsVisualModelRuntime).toBe(false);
  });

  it("publishes the canonical Computer Agent contract identities", () => {
    const route = getVisualTestingRoute();
    expect(route.computerAgentContracts).toEqual({
      readiness: "evavo_computer_agent_capabilities_v2",
      protocolCapabilities: "evavo.computer-agent.protocol-capabilities.v1",
      toolSurface: "evavo.computer-agent.tool-surface.v1",
      grounding: "evavo.computer-agent.grounding.v1",
      elementEvidence: "evavo.computer-agent.element-evidence.v1",
    });
    expect(route.truth.protocolPresenceIsOperationReadiness).toBe(false);
    expect(route.truth.toolSurfacePresenceIsRuntimeReadiness).toBe(false);
    expect(route.truth.visualModelSourceIsExecutionProof).toBe(false);
  });
});
