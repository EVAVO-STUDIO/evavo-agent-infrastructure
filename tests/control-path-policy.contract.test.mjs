import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const routing = JSON.parse(fs.readFileSync(path.join(root, "config", "agent-capability-routing-v1.json"), "utf8"));
const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "control-path-policy-v1.json"), "utf8"));

test("routing references canonical least-disruptive control policy", () => {
  assert.equal(routing.fragments.controlPathPolicy, "control-path-policy-v1.json");
  assert.equal(routing.policy.preferLeastDisruptiveControlPath, true);
  assert.equal(routing.policy.preserveUserFocusWhenPossible, true);
  assert.equal(routing.policy.foregroundEscalationRequiresBackgroundInsufficiency, true);
  assert.equal(routing.policy.physicalConsoleIsFallbackNotDefault, true);
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
