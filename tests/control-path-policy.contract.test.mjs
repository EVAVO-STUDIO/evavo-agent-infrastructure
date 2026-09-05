import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, "config", name), "utf8"));
const routing = readJson("agent-capability-routing-v1.json");
const policy = readJson("control-path-policy-v1.json");
const health = readJson("workstation-control-health-v1.json");
const transports = readJson("agent-capability-transports-v1.json");
const chatgpt = readJson("chatgpt-unified-capability-surface.v1.json");
const registration = readJson("chatgpt-unified-mcp-registration.v1.json");

test("strict routing stays zero-cost while control policy governs disruption", () => {
  assert.equal(routing.policy.selection, "first-eligible-in-declared-order");
  assert.equal(routing.policy.allowGitHubActions, false);
  assert.equal(routing.policy.allowVercelAsExecutionAuthority, false);
  assert.equal(routing.policy.allowArbitraryShell, false);
  assert.equal(policy.default.preferBackground, true);
  assert.equal(policy.default.preserveUserFocus, true);
  assert.equal(policy.default.foregroundOnlyWhenBackgroundInsufficient, true);
  assert.equal(policy.default.remoteDoesNotMeanBackground, true);
});

test("background and isolated routes precede real-console routes", () => {
  const routes = policy.routeOrder;
  const byClass = Object.fromEntries(routes.map((item) => [item.routeClass, item]));
  assert.ok(byClass["typed-api-or-connector"].rank < byClass["local-compute-background"].rank);
  assert.ok(byClass["local-compute-background"].rank < byClass["native-desktop"].rank);
  assert.ok(byClass["isolated-browser"].rank < byClass["native-desktop"].rank);
  assert.ok(byClass["native-desktop"].rank < byClass["s3-hid"].rank);
  assert.ok(byClass["s3-hid"].rank < byClass["comet-kvm"].rank);
  assert.ok(byClass["comet-kvm"].rank < byClass["oob-recovery"].rank);
  assert.equal(byClass["local-compute-background"].disruption, "none");
  assert.equal(byClass["s3-hid"].disruption, "physical-console");
  assert.equal(byClass["comet-kvm"].disruption, "physical-console");
  assert.equal(byClass["oob-recovery"].disruption, "recovery-impact");
});

test("Desktop Commander and external desktop-control fallbacks are disabled", () => {
  assert.equal(policy.default.externalDesktopCommanderEnabled, false);
  assert.equal(policy.default.externalRemoteDesktopFallbackAllowed, false);
  assert.equal(policy.default.localVerificationRequiresExternalDesktopTool, false);
  assert.ok(!policy.routeOrder.some((route) => /desktop-commander|external-fallback/i.test(String(route.routeClass))));
  assert.ok(!Object.keys(transports).some((name) => /desktop-commander/i.test(name)));
  assert.equal(chatgpt.routing.externalDesktopControlAllowed, false);
  assert.equal(chatgpt.remoteRelay.desktopCommanderAllowed, false);
  assert.equal(registration.hostPolicy.externalDesktopControlAllowed, false);
  assert.equal(fs.existsSync(path.join(root, "config", "desktop-commander-interop-v1.json")), false);
});

test("EVAVO typed relay outranks the GitHub queue for remote effectful work", () => {
  const localCompute = policy.routeOrder.find((item) => item.routeClass === "local-compute-background");
  assert.deepEqual(localCompute.remoteTransportPreference, ["cloudflare-typed-relay", "github-issue-queue"]);
  assert.deepEqual(chatgpt.sessionContinuity.fallbackOrderWhenNativeNamespaceAbsent, ["cloudflare-typed-relay", "github-receipt-relay"]);
  assert.equal(chatgpt.routing.remoteEffectfulPrimary, "cloudflare-typed-relay");
  assert.equal(chatgpt.routing.remoteEffectfulFallback, "github-receipt-relay");
  assert.equal(chatgpt.remoteRelay.transport, "cloudflare-typed-relay");
  assert.equal(chatgpt.remoteRelay.workstationConnection, "outbound-websocket-only");
  assert.equal(chatgpt.remoteRelay.typedAllowlistRequired, true);
  assert.equal(chatgpt.remoteRelay.automaticReplayAllowed, false);
  assert.equal(transports["cloudflare-typed-relay"].physicalReceiptCapable, true);
  assert.equal(transports["github-issue-queue"].minimumState, "configured");
  assert.equal(registration.hostPolicy.remoteEffectfulPrimaryTransport, "cloudflare-typed-relay");
  assert.equal(registration.hostPolicy.githubReceiptRelayRole, "asynchronous-fallback");
});

test("ChatGPT and Claude client rules remain explicit and native-only", () => {
  assert.match(policy.clientRules["chatgpt-pro"], /registration/i);
  assert.match(policy.clientRules["chatgpt-pro"], /reconnect|negotiated/i);
  assert.match(policy.clientRules["chatgpt-pro"], /cloudflare-typed-relay/i);
  assert.match(policy.clientRules["chatgpt-pro"], /never use Desktop Commander/i);
  assert.match(policy.clientRules["claude-code"], /local mcp|local compute/i);
  assert.match(policy.clientRules["claude-code"], /cloudflare-typed-relay/i);
});

test("hardware profiles distinguish current stage from full fabric", () => {
  assert.deepEqual(policy.hardwareProfiles.s3_comet.required, ["s3_hid", "comet_visual"]);
  assert.ok(policy.hardwareProfiles.s3_comet.optional.includes("c5_radio"));
  assert.deepEqual(policy.hardwareProfiles.full.required, ["s3_hid", "comet_visual", "c5_radio"]);
});

test("self-heal remains owner-scoped and never silently escalates", () => {
  assert.equal(health.kind, "evavo-workstation-control-health-v1");
  const gateway = health.components.find((item) => item.id === "hardware-gateway");
  const oob = health.components.find((item) => item.id === "out-of-band-control");
  assert.ok(gateway.forbiddenSelfHeal.includes("automatic HID"));
  assert.ok(gateway.forbiddenSelfHeal.includes("automatic firmware flash"));
  assert.ok(oob.forbiddenSelfHeal.includes("automatic hard reset"));
  assert.ok(health.evaluationOrder.indexOf("local-compute") < health.evaluationOrder.indexOf("hardware-gateway-s3-hid"));
  assert.ok(health.evaluationOrder.indexOf("hardware-gateway-s3-hid") < health.evaluationOrder.indexOf("out-of-band-control"));
});
