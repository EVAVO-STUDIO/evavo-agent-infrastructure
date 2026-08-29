import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const routing = JSON.parse(fs.readFileSync(path.join(root, "config", "agent-capability-routing-v1.json"), "utf8"));
const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "control-path-policy-v1.json"), "utf8"));
const health = JSON.parse(fs.readFileSync(path.join(root, "config", "workstation-control-health-v1.json"), "utf8"));

test("strict routing schema stays zero-cost while sibling control policy governs disruption", () => {
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

test("ChatGPT and Claude have explicit local-control client rules", () => {
  assert.match(policy.clientRules["chatgpt-pro"], /registration/i);
  assert.match(policy.clientRules["chatgpt-pro"], /reconnect|negotiated/i);
  assert.match(policy.clientRules["claude-code"], /local mcp|local compute/i);
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
