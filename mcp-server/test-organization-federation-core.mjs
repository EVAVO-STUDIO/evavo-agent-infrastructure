#!/usr/bin/env node

import assert from 'node:assert/strict';
import { callOrganizationFederationTool, organizationFederationMcpContract, organizationFederationTools } from './organization-federation-core.mjs';

assert.equal(organizationFederationMcpContract.readOnly, true);
assert.equal(organizationFederationMcpContract.executionAuthority, false);
assert.equal(organizationFederationMcpContract.mutationAuthority, false);
assert.deepEqual(
  organizationFederationTools.map((tool) => tool.name).sort(),
  [
    'evavo_list_specialist_domain_owners',
    'evavo_plan_capability_route_readiness',
    'evavo_plan_specialist_team',
    'evavo_validate_specialist_handoff'
  ].sort()
);

const uxOwners = await callOrganizationFederationTool('evavo_list_specialist_domain_owners', { domain: 'user-experience' });
assert.equal(uxOwners.executionAuthorized, false);
assert.equal(uxOwners.owners.some((owner) => owner.ownerId === 'ux' && owner.repository === 'EVAVO-STUDIO/ux-studio'), true);

const celTeam = await callOrganizationFederationTool('evavo_plan_specialist_team', { patternId: 'cel-vfx-production' });
assert.equal(celTeam.executionAuthorized, false);
assert.equal(celTeam.selectedPattern, 'cel-vfx-production');
assert.equal(celTeam.team[0].specialistId, 'particle');
assert.equal(celTeam.team[1].specialistId, 'cel-animation');
assert.equal(celTeam.unresolved.length, 0);

const missingEvidence = await callOrganizationFederationTool('evavo_plan_capability_route_readiness', {
  capability: 'organization.specialist-team-plan',
  client: 'claude-code',
  evidence: {},
  nowMs: Date.parse('2026-09-07T05:00:00.000Z')
});
assert.equal(missingEvidence.executionAuthorized, false);
assert.equal(missingEvidence.status, 'readiness-required');
assert.equal(missingEvidence.selectedStrategy, null);
assert.equal(missingEvidence.candidates[0].blockers.includes('missing-or-stale-readiness-evidence'), true);

const readyEvidence = await callOrganizationFederationTool('evavo_plan_capability_route_readiness', {
  capability: 'organization.specialist-team-plan',
  client: 'claude-code',
  evidence: {
    strategies: {
      'organization-team-plan-local-mcp': {
        state: 'transport_online',
        observedAt: '2026-09-07T04:59:30.000Z',
        healthy: true
      }
    },
    authorities: {
      'agent-infrastructure': { eligible: true }
    }
  },
  nowMs: Date.parse('2026-09-07T05:00:00.000Z')
});
assert.equal(readyEvidence.executionAuthorized, false);
assert.equal(readyEvidence.status, 'eligible-route-found');
assert.equal(readyEvidence.selectedStrategy.strategyId, 'organization-team-plan-local-mcp');
assert.equal(readyEvidence.selectedStrategy.requestedEffect, 'read');

const handoff = await callOrganizationFederationTool('evavo_validate_specialist_handoff', {
  handoff: {
    contractVersion: 'evavo_specialist_handoff_v1',
    handoffId: 'cel-vfx-handoff-test-001',
    objective: 'Turn deterministic particle timing into a drawn cel-animation effect.',
    from: { specialist: 'particle', repository: 'EVAVO-STUDIO/particle-studio', sourceRevision: null },
    to: { specialist: 'cel-animation', repository: 'EVAVO-STUDIO/cel-animation-studio', sourceRevision: null },
    domainOwner: { ownerId: 'cel-animation', repository: 'EVAVO-STUDIO/cel-animation-studio', validated: true },
    requestedCapability: 'cel-animation.production',
    requestedEffect: 'read',
    authority: { authorityId: null, authorityRepository: null, validated: false, routeId: null, strategyId: null, minimumState: null },
    inputs: [],
    constraints: ['Preserve cel/drawn visual language.'],
    expectedOutputs: ['A reviewed cel-animation production plan.'],
    acceptanceCriteria: ['No procedural particle look remains in the final visual standard.'],
    evidence: { sourceReferences: [], requiredReceipts: [], priorReceiptReferences: [] },
    executionAuthority: { grantedByEnvelope: false, requiresIndependentAdmission: true }
  }
});
assert.equal(handoff.valid, true);
assert.equal(handoff.domainOwnerValidated, true);
assert.equal(handoff.effectRouteBound, false);
assert.equal(handoff.executionAuthorized, false);
assert.equal(handoff.warnings.includes('authority:not-yet-bound;handoff-is-planning-only'), true);

const unresolvedDevice = await callOrganizationFederationTool('evavo_plan_specialist_team', { patternId: 'device-control' });
assert.equal(unresolvedDevice.executionAuthorized, false);
assert.equal(unresolvedDevice.unresolved.some((member) => member.specialistId === 'universal-manipulator'), true);

console.log('Organization federation MCP core: OK');
