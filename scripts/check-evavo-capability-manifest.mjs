#!/usr/bin/env node

import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("evavo.capabilities.json", "utf8"));
const errors = [];
const allowedInterfaces = new Set(["api", "automation", "cli", "desktop", "game", "library", "mcp", "mobile", "openapi", "testing", "ui", "web-app"]);
const allowedEffects = new Set(["read", "compute", "network", "write", "execute", "publish", "financial"]);
const requiredCapabilityIds = new Set([
  "agent.capabilities.route",
  "agent.windows.execution-route",
  "agent.codex.spark-capacity",
  "agent.codex.test-builder",
  "agent.remote.typed-relay",
  "agent.github.estate-observe",
]);
const idPattern = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const credentialPattern = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b|\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret|token)\b\s*[:=]\s*["']?[^\s"',;}{]{6,}/i;

const requireValue = (condition, message) => {
  if (!condition) errors.push(message);
};
requireValue(manifest.contractVersion === "evavo_repository_capabilities_v1", "Capability manifest contract version is invalid.");
requireValue(manifest.repository === "EVAVO-STUDIO/evavo-agent-infrastructure", "Capability manifest repository identity is invalid.");
requireValue(manifest.authority === "agent-infrastructure", "Capability manifest authority is invalid.");
requireValue(typeof manifest.summary === "string" && manifest.summary.length > 20, "Capability manifest summary is missing.");
requireValue(Array.isArray(manifest.capabilities) && manifest.capabilities.length > 0 && manifest.capabilities.length <= 50, "Capability manifest must contain 1-50 capabilities.");

const ids = [];
for (const [index, capability] of (manifest.capabilities ?? []).entries()) {
  const label = `capabilities[${index}]`;
  requireValue(typeof capability.id === "string" && idPattern.test(capability.id), `${label}.id is invalid.`);
  ids.push(capability.id);
  for (const field of ["title", "description"]) requireValue(typeof capability[field] === "string" && capability[field].trim().length > 0, `${label}.${field} is required.`);
  for (const field of ["interfaces", "effects", "entrypoints", "tags", "requires"]) requireValue(Array.isArray(capability[field]), `${label}.${field} must be an array.`);
  for (const value of capability.interfaces ?? []) requireValue(allowedInterfaces.has(value), `${label}.interfaces contains unsupported value ${value}.`);
  for (const value of capability.effects ?? []) requireValue(allowedEffects.has(value), `${label}.effects contains unsupported value ${value}.`);
  requireValue(!(capability.effects ?? []).includes("publish"), `${label} must not claim publication authority.`);
  requireValue(!(capability.effects ?? []).includes("financial"), `${label} must not claim financial authority.`);
}
requireValue(new Set(ids).size === ids.length, "Capability IDs must be unique.");
for (const id of requiredCapabilityIds) requireValue(ids.includes(id), `Required capability is missing: ${id}.`);
requireValue(manifest.brain?.consult === true, "brain.consult must be true.");
requireValue(manifest.brain?.sanityCheck === true, "brain.sanityCheck must be true.");
requireValue(Array.isArray(manifest.brain?.topics) && manifest.brain.topics.length > 0, "brain.topics must be non-empty.");
requireValue(typeof manifest.reviewedAt === "string" && Number.isFinite(Date.parse(manifest.reviewedAt)), "reviewedAt must be a valid ISO-8601 timestamp.");
requireValue(!credentialPattern.test(fs.readFileSync("evavo.capabilities.json", "utf8")), "Capability manifest contains credential-like material.");

const testBuilder = manifest.capabilities?.find((entry) => entry.id === "agent.codex.test-builder");
requireValue(testBuilder?.effects?.includes("execute") === true && testBuilder?.effects?.includes("write") === true, "Test Builder must truthfully declare execute and write effects.");
requireValue(testBuilder?.description?.includes("no publication") === true, "Test Builder description must preserve the no-publication boundary.");
requireValue(testBuilder?.requires?.some((value) => value.includes("External deterministic validation")) === true, "Test Builder must require independent deterministic validation.");

if (errors.length) {
  console.error("EVAVO capability manifest check failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("EVAVO capability manifest check passed.");
console.log("- Brain can discover Agent Infrastructure from a strict repository manifest");
console.log("- effectful Test Builder capability is declared without publication or financial authority");
console.log("- capability, Windows, Spark, relay and GitHub-estate routing surfaces are explicit");
