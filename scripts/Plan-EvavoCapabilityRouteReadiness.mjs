#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const STATE_ORDER = ['unknown', 'source_ready', 'configured', 'transport_online', 'accepted', 'completed', 'physically_verified'];

function parseArgs(argv) {
  const args = { capability: null, client: 'chatgpt-pro', evidence: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--capability') args.capability = argv[++i] ?? null;
    else if (token === '--client') args.client = argv[++i] ?? null;
    else if (token === '--evidence') args.evidence = argv[++i] ?? null;
    else if (token === '--json') args.json = true;
    else if (token === '--help' || token === '-h') {
      console.log('Usage: node scripts/Plan-EvavoCapabilityRouteReadiness.mjs --capability <id> [--client chatgpt-pro] [--evidence evidence.json] [--json]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.capability) throw new Error('--capability is required');
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function rank(state) {
  const index = STATE_ORDER.indexOf(state);
  return index >= 0 ? index : 0;
}

function normalizeObservedAt(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function freshEnough(record, freshnessSeconds, nowMs) {
  if (!record) return false;
  if (record.healthy === false) return false;
  const observed = normalizeObservedAt(record.observedAt);
  if (observed == null) return false;
  return nowMs - observed <= freshnessSeconds * 1000;
}

function loadRoutes(configDir) {
  const root = readJson(path.join(configDir, 'agent-capability-routing-v1.json'));
  const routes = [];
  for (const fragment of root?.fragments?.routes ?? []) {
    const parsed = readJson(path.join(configDir, fragment));
    if (!Array.isArray(parsed)) throw new Error(`Route fragment must be an array: ${fragment}`);
    for (const route of parsed) routes.push({ ...route, sourceFragment: fragment });
  }
  return { root, routes };
}

function plan({ configDir, capability, client, evidence, nowMs = Date.now() }) {
  const { root, routes } = loadRoutes(configDir);
  const authorities = readJson(path.join(configDir, 'agent-capability-authorities-v1.json'));
  const transports = readJson(path.join(configDir, 'agent-capability-transports-v1.json'));
  const federation = readJson(path.join(configDir, 'organization-capability-federation-v1.json'));

  const route = routes.find((entry) => entry?.capability === capability);
  if (!route) {
    return {
      schemaVersion: 1,
      kind: 'evavo-capability-route-readiness-plan-v1',
      capability,
      client,
      status: 'unknown-capability',
      selectedStrategy: null,
      candidates: [],
      executionAuthorized: false,
      nextAction: 'Run Brain specialist discovery and capability-estate refresh; do not invent a route or use generic shell fallback.'
    };
  }

  const requestedEffect = route.requestedEffect ?? 'read';
  const candidates = [];

  for (let index = 0; index < (route.strategies ?? []).length; index += 1) {
    const strategy = route.strategies[index];
    if (!Array.isArray(strategy.clients) || !strategy.clients.includes(client)) continue;

    const authority = authorities[strategy.authority] ?? null;
    const transport = transports[strategy.transport] ?? null;
    const authorityOwnsEffect = Boolean(authority && Array.isArray(authority.effects) && authority.effects.includes(requestedEffect));
    const transportSupportsEffect = Boolean(transport && Array.isArray(transport.effects) && transport.effects.includes(requestedEffect));
    const transportSupportsClient = Boolean(transport && Array.isArray(transport.clients) && transport.clients.includes(client));
    const unresolvedAuthority = Boolean(authority && /unresolved|not eligible|restore|planned canonical/i.test(authority.description ?? ''));

    const routeEvidence = evidence?.strategies?.[strategy.id] ?? null;
    const transportEvidence = evidence?.transports?.[strategy.transport] ?? null;
    const authorityEvidence = evidence?.authorities?.[strategy.authority] ?? null;
    const observedState = routeEvidence?.state ?? transportEvidence?.state ?? 'unknown';
    const minimumState = strategy.minimumState ?? transport?.minimumState ?? 'transport_online';
    const freshnessSeconds = Number(transport?.freshnessSeconds ?? 0);
    const fresh = freshnessSeconds > 0 && freshEnough(routeEvidence ?? transportEvidence, freshnessSeconds, nowMs);
    const stateSatisfied = rank(observedState) >= rank(minimumState);
    const authorityAccepted = authorityEvidence?.eligible === false ? false : true;

    const blockers = [];
    if (!authority) blockers.push('unknown-authority');
    if (!transport) blockers.push('unknown-transport');
    if (!authorityOwnsEffect) blockers.push('authority-does-not-own-requested-effect');
    if (!transportSupportsEffect) blockers.push('transport-does-not-support-requested-effect');
    if (!transportSupportsClient) blockers.push('transport-does-not-support-client');
    if (unresolvedAuthority) blockers.push('authority-unresolved');
    if (!fresh) blockers.push('missing-or-stale-readiness-evidence');
    if (!stateSatisfied) blockers.push(`minimum-state-not-met:${minimumState}`);
    if (!authorityAccepted) blockers.push('authority-currently-ineligible');

    const eligible = blockers.length === 0;
    candidates.push({
      declaredOrder: index,
      strategyId: strategy.id,
      authorityId: strategy.authority,
      authorityRepository: authority?.repository ?? null,
      transportId: strategy.transport,
      requestedEffect,
      minimumState,
      observedState,
      evidenceFresh: fresh,
      freshnessSeconds,
      receiptRequired: transport?.receiptRequired === true,
      physicalReceiptCapable: transport?.physicalReceiptCapable === true,
      routineCost: transport?.routineCost ?? null,
      probe: transport?.probe ?? null,
      eligible,
      blockers
    });
  }

  const selectedStrategy = candidates.find((candidate) => candidate.eligible) ?? null;
  const status = selectedStrategy ? 'eligible-route-found' : 'readiness-required';

  return {
    schemaVersion: 1,
    kind: 'evavo-capability-route-readiness-plan-v1',
    generatedAt: new Date(nowMs).toISOString(),
    capability,
    client,
    requestedEffect,
    routeId: route.id ?? null,
    routeDescription: route.description ?? null,
    routeSourceFragment: route.sourceFragment ?? null,
    selectionPolicy: root?.policy?.selection ?? federation?.selectionPolicy?.principle ?? 'first-eligible-in-declared-order',
    status,
    selectedStrategy,
    candidates,
    probesRequired: candidates.filter((candidate) => !candidate.eligible).map((candidate) => ({
      strategyId: candidate.strategyId,
      transportId: candidate.transportId,
      probe: candidate.probe,
      blockers: candidate.blockers
    })),
    executionAuthorized: false,
    executionRule: 'This plan selects or diagnoses a route only. Execution still requires the selected authority/transport to perform the typed operation and return the required correlated receipt/postcondition evidence.'
  };
}

const args = parseArgs(process.argv.slice(2));
const scriptDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)));
const repoDir = path.resolve(scriptDir, '..');
const configDir = path.join(repoDir, 'config');
const evidence = args.evidence ? readJson(path.resolve(args.evidence)) : {};
const result = plan({ configDir, capability: args.capability, client: args.client, evidence });

if (args.json || true) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
