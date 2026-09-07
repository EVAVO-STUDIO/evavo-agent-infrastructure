#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))), '..');
const configDir = path.join(repoDir, 'config');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(configDir, name), 'utf8'));
}

const federation = readJson('organization-capability-federation-v1.json');
const handoffs = readJson('specialist-handoff-graph-v1.json');
const authorities = readJson('agent-capability-authorities-v1.json');
const transports = readJson('agent-capability-transports-v1.json');
const readinessPlanner = fs.readFileSync(path.join(repoDir, 'scripts', 'Plan-EvavoCapabilityRouteReadiness.mjs'), 'utf8');

if (federation?.kind !== 'evavo-organization-capability-federation-v1' || federation?.canonical !== true) throw new Error('Missing canonical federation contract');
if (federation?.invariants?.discoveryIsNotAuthorization !== true) throw new Error('Federation must preserve discovery/authorization boundary');
if (federation?.invariants?.authorityRegistryIsCanonicalForEffects !== true) throw new Error('Authority registry must remain canonical for effects');
if (federation?.invariants?.specialistsRemainIndependentlyUsable !== true) throw new Error('Specialists must remain independently usable');
if (federation?.invariants?.crossSpecialistHandoffsPreserveOwnership !== true) throw new Error('Handoffs must preserve ownership');
if (federation?.invariants?.unresolvedAuthoritiesFailClosed !== true) throw new Error('Unresolved authorities must fail closed');
if (federation?.invariants?.noGitHubActionsRequired !== true) throw new Error('GitHub Actions must not be required');
if (federation?.invariants?.noVercelExecutionAuthority !== true) throw new Error('Vercel must not become execution authority');

if (handoffs?.kind !== 'evavo-specialist-handoff-graph-v1' || handoffs?.canonical !== true) throw new Error('Missing canonical specialist handoff graph');
if (handoffs?.rules?.handoffPreservesAuthority !== true || handoffs?.rules?.receiverOwnsReceiverEffect !== true) throw new Error('Specialist handoff ownership rules are incomplete');
if (!Array.isArray(handoffs?.patterns) || handoffs.patterns.length < 5) throw new Error('Specialist handoff graph is unexpectedly sparse');

for (const pattern of handoffs.patterns) {
  if (!pattern?.id || !Array.isArray(pattern?.sequence) || pattern.sequence.length < 2) throw new Error(`Invalid handoff pattern: ${pattern?.id ?? 'unknown'}`);
}

if (!authorities?.['agent-infrastructure'] || !authorities?.brain || !authorities?.['development-governance']) throw new Error('Core organisational authorities are missing');
if (!transports?.['local-specialist-mcp'] || !transports?.['structured-workstation-bridge'] || !transports?.['durable-local-execution']) throw new Error('Core local transports are missing');

const requiredPlannerTokens = [
  "kind: 'evavo-capability-route-readiness-plan-v1'",
  "status: 'unknown-capability'",
  "executionAuthorized: false",
  'missing-or-stale-readiness-evidence',
  'authority-does-not-own-requested-effect',
  'authority-unresolved',
  'first-eligible-in-declared-order'
];
for (const token of requiredPlannerTokens) {
  if (!readinessPlanner.includes(token)) throw new Error(`Readiness planner contract missing token: ${token}`);
}

console.log('EVAVO organization federation contract: OK');
