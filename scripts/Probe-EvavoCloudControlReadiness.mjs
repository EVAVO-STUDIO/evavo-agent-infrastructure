#!/usr/bin/env node

import { lookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_PATH = path.join(ROOT, "config", "cloud-control-endpoints-v1.json");
const TIMEOUT_MS = 8000;
const MAX_HEALTH_BYTES = 64 * 1024;

function readRegistry() {
  const value = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  if (
    value?.schemaVersion !== 1 ||
    value?.kind !== "evavo-cloud-control-endpoints-v1" ||
    !value?.endpoints ||
    typeof value.endpoints !== "object"
  ) {
    throw new Error("EVAVO_CLOUD_CONTROL_ENDPOINT_REGISTRY_INVALID");
  }
  return value;
}

function safeHealth(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const allowed = [
    "ok",
    "version",
    "workstationRequired",
    "providerCredentialConfigured",
    "controlCredentialConfigured",
    "desiredStateReconcilerConfigured",
    "desiredStateRepository",
    "desiredStatePath",
    "desiredStateCronMinutes",
    "productionBranchReconciliation",
    "credentialValuesReturned",
  ];
  return Object.fromEntries(allowed.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
}

async function probe(id, endpoint) {
  const baseUrl = new URL(String(endpoint.baseUrl));
  const healthUrl = new URL(String(endpoint.healthPath || "/health"), baseUrl);
  const blockers = [];
  let dnsResolved = false;
  let dnsAddressCount = 0;
  let healthHttpStatus = null;
  let health = null;

  try {
    const rows = await lookup(baseUrl.hostname, { all: true, verbatim: true });
    dnsResolved = rows.length > 0;
    dnsAddressCount = rows.length;
  } catch {
    blockers.push("dns-unresolved");
  }

  if (dnsResolved) {
    try {
      const response = await fetch(healthUrl, {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          accept: "application/json",
          "user-agent": "EVAVO-Cloud-Control-Readiness/1.0",
        },
      });
      healthHttpStatus = response.status;
      const declared = Number(response.headers.get("content-length") || 0);
      if (Number.isFinite(declared) && declared > MAX_HEALTH_BYTES) {
        blockers.push("health-response-too-large");
      } else {
        const raw = await response.text();
        if (Buffer.byteLength(raw, "utf8") > MAX_HEALTH_BYTES) {
          blockers.push("health-response-too-large");
        } else {
          try { health = safeHealth(JSON.parse(raw)); }
          catch { blockers.push("health-invalid-json"); }
        }
      }
      if (response.status !== 200) blockers.push(`health-http-${response.status}`);
    } catch {
      blockers.push("health-unreachable");
    }
  }

  if (health?.ok !== true) blockers.push("health-ok-not-proven");
  if (id === "vercel-provider-cloud-mcp") {
    if (health?.workstationRequired !== false) blockers.push("workstation-independence-not-proven");
    if (health?.providerCredentialConfigured !== true) blockers.push("provider-credential-not-proven");
    if (health?.controlCredentialConfigured !== true) blockers.push("control-credential-not-proven");
    if (health?.desiredStateReconcilerConfigured !== true) blockers.push("desired-state-reconciler-not-proven");
  }

  const uniqueBlockers = [...new Set(blockers)];
  return {
    id,
    configured: true,
    configuredDoesNotMeanDeployed: true,
    baseUrl: endpoint.baseUrl,
    workstationRequired: endpoint.workstationRequired === true,
    dnsResolved,
    dnsAddressCount,
    healthHttpStatus,
    health,
    healthy: uniqueBlockers.length === 0,
    state: uniqueBlockers.length === 0 ? "transport_online" : "configured",
    blockers: uniqueBlockers,
    credentialValuesReturned: false,
    mutationPerformed: false,
  };
}

async function main() {
  const registry = readRegistry();
  const requestedIndex = process.argv.indexOf("--endpoint");
  const requested = requestedIndex >= 0 ? String(process.argv[requestedIndex + 1] || "") : "";
  if (requested && !registry.endpoints[requested]) throw new Error("EVAVO_CLOUD_CONTROL_ENDPOINT_UNKNOWN");

  const selected = requested ? [[requested, registry.endpoints[requested]]] : Object.entries(registry.endpoints);
  const endpoints = {};
  for (const [id, endpoint] of selected) endpoints[id] = await probe(id, endpoint);

  const value = {
    schemaVersion: 1,
    kind: "evavo-cloud-control-readiness-v1",
    observedAt: new Date().toISOString(),
    endpointRegistry: "config/cloud-control-endpoints-v1.json",
    configuredEndpointIsAvailabilityEvidence: false,
    liveHealthRequiredForSelection: true,
    endpoints,
    allHealthy: Object.values(endpoints).every((endpoint) => endpoint.healthy),
    mutationPerformed: false,
    credentialValuesReturned: false,
  };
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

await main();
