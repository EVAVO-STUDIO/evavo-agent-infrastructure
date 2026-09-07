#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const STATES = ['unknown', 'source_ready', 'configured', 'transport_online', 'accepted', 'completed', 'physically_verified'];
const EFFECTS = new Set(['read', 'write', 'execute', 'control', 'publish']);

function parseArgs(argv) {
  const args = { input: null, json: false, strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--input') args.input = argv[++i] ?? null;
    else if (token === '--json') args.json = true;
    else if (token === '--strict') args.strict = true;
    else if (token === '--help' || token === '-h') {
      console.log('Usage: node scripts/Validate-EvavoSpecialistHandoff.mjs --input <handoff.json> [--json] [--strict]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.input) throw new Error('--input is required');
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function requireString(value, field, errors) {
  if (typeof value !== 'string' || value.trim() === '') errors.push(`${field}:required-string`);
}

function validateRepository(value, field, errors, { allowNull = false } = {}) {
  if (value == null && allowNull) return;
  requireString(value, field, errors);
  if (typeof value === 'string' && !/^EVAVO-STUDIO\/[A-Za-z0-9._-]+$/.test(value)) errors.push(`${field}:invalid-repository`);
}

function validateSha(value, field, length, errors) {
  if (value == null) return;
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) errors.push(`${field}:invalid-digest`);
}

const args = parseArgs(process.argv.slice(2));
const scriptDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)));
const repoDir = path.resolve(scriptDir, '..');
const configDir = path.join(repoDir, 'config');
const handoff = readJson(path.resolve(args.input));
const authorities = readJson(path.join(configDir, 'agent-capability-authorities-v1.json'));
const domainOwners = readJson(path.join(configDir, 'specialist-domain-owners-v1.json'))?.owners ?? {};
const routingRoot = readJson(path.join(configDir, 'agent-capability-routing-v1.json'));
const routes = [];
for (const fragment of routingRoot?.fragments?.routes ?? []) {
  const parsed = readJson(path.join(configDir, fragment));
  if (Array.isArray(parsed)) routes.push(...parsed);
}

const errors = [];
const warnings = [];

if (handoff?.contractVersion !== 'evavo_specialist_handoff_v1') errors.push('contractVersion:unsupported');
requireString(handoff?.handoffId, 'handoffId', errors);
requireString(handoff?.objective, 'objective', errors);
requireString(handoff?.from?.specialist, 'from.specialist', errors);
validateRepository(handoff?.from?.repository, 'from.repository', errors);
validateSha(handoff?.from?.sourceRevision, 'from.sourceRevision', 40, errors);
requireString(handoff?.to?.specialist, 'to.specialist', errors);
validateRepository(handoff?.to?.repository, 'to.repository', errors);
validateSha(handoff?.to?.sourceRevision, 'to.sourceRevision', 40, errors);
requireString(handoff?.requestedCapability, 'requestedCapability', errors);
if (!EFFECTS.has(handoff?.requestedEffect)) errors.push('requestedEffect:unsupported');
if (!Array.isArray(handoff?.inputs)) errors.push('inputs:array-required');
if (!Array.isArray(handoff?.constraints)) errors.push('constraints:array-required');
if (!Array.isArray(handoff?.expectedOutputs) || handoff.expectedOutputs.length === 0) errors.push('expectedOutputs:non-empty-array-required');
if (!Array.isArray(handoff?.acceptanceCriteria) || handoff.acceptanceCriteria.length === 0) errors.push('acceptanceCriteria:non-empty-array-required');
if (!Array.isArray(handoff?.evidence?.sourceReferences)) errors.push('evidence.sourceReferences:array-required');
if (!Array.isArray(handoff?.evidence?.requiredReceipts)) errors.push('evidence.requiredReceipts:array-required');
if (handoff?.executionAuthority?.grantedByEnvelope !== false) errors.push('executionAuthority.grantedByEnvelope:must-be-false');
if (handoff?.executionAuthority?.requiresIndependentAdmission !== true) errors.push('executionAuthority.requiresIndependentAdmission:must-be-true');

for (const [index, input] of (handoff?.inputs ?? []).entries()) {
  requireString(input?.kind, `inputs[${index}].kind`, errors);
  requireString(input?.reference, `inputs[${index}].reference`, errors);
  validateSha(input?.sha256, `inputs[${index}].sha256`, 64, errors);
}

const domainOwnerId = handoff?.domainOwner?.ownerId;
const domainOwner = domainOwnerId ? domainOwners[domainOwnerId] : null;
if (!domainOwner) errors.push('domainOwner:unknown-owner-id');
else {
  if (domainOwner.repository !== handoff?.domainOwner?.repository) errors.push('domainOwner:repository-mismatch');
  if (domainOwner.repository !== handoff?.to?.repository) errors.push('domainOwner:receiving-repository-mismatch');
  if (domainOwner.status === 'source-unresolved') errors.push('domainOwner:source-unresolved');
}
if (handoff?.domainOwner?.validated !== true) errors.push('domainOwner:validated-must-be-true');

const authorityId = handoff?.authority?.authorityId ?? null;
const authority = authorityId ? authorities[authorityId] : null;
if (authorityId && !authority) errors.push('authority:unknown-authority-id');
if (!authorityId && handoff?.authority?.validated === true) errors.push('authority:cannot-be-validated-without-authority-id');

if (authority) {
  if (authority.repository !== handoff?.authority?.authorityRepository) errors.push('authority:repository-mismatch');
  if (!Array.isArray(authority.effects) || !authority.effects.includes(handoff?.requestedEffect)) errors.push('authority:requested-effect-not-owned');
  if (/unresolved|not eligible|restore|planned canonical/i.test(authority.description ?? '')) errors.push('authority:unresolved-or-ineligible');
}

validateRepository(handoff?.authority?.authorityRepository, 'authority.authorityRepository', errors, { allowNull: true });
if (handoff?.authority?.minimumState != null && !STATES.includes(handoff.authority.minimumState)) errors.push('authority:invalid-minimum-state');

if (handoff?.authority?.routeId) {
  if (!authorityId) errors.push('authority:route-requires-authority-id');
  const route = routes.find((entry) => entry?.id === handoff.authority.routeId);
  if (!route) errors.push('authority:unknown-route-id');
  else {
    if (route.capability !== handoff.requestedCapability) errors.push('authority:route-capability-mismatch');
    if (route.requestedEffect !== handoff.requestedEffect) errors.push('authority:route-effect-mismatch');
    if (handoff?.authority?.strategyId) {
      const strategy = (route.strategies ?? []).find((entry) => entry?.id === handoff.authority.strategyId);
      if (!strategy) errors.push('authority:unknown-strategy-id');
      else if (strategy.authority !== authorityId) errors.push('authority:strategy-authority-mismatch');
    }
  }
} else if (handoff.requestedEffect !== 'read') {
  warnings.push('authority:no-route-bound-for-effectful-handoff');
}

if (!authorityId) warnings.push('authority:not-yet-bound;handoff-is-planning-only');
if (handoff?.authority?.validated !== true) warnings.push('authority:not-currently-validated');

const valid = errors.length === 0;
const effectReady = valid && Boolean(authorityId) && handoff?.authority?.validated === true && Boolean(handoff?.authority?.routeId);
const result = {
  schemaVersion: 1,
  kind: 'evavo-specialist-handoff-validation-v1',
  handoffId: handoff?.handoffId ?? null,
  valid,
  domainOwnerValidated: valid && Boolean(domainOwner),
  effectRouteBound: effectReady,
  errors,
  warnings,
  executionAuthorized: false,
  policy: {
    domainOwnershipIsSeparateFromMachineAuthority: true,
    handoffPreservesAuthority: true,
    independentAdmissionStillRequired: true,
    validationDoesNotExecute: true
  }
};

if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else {
  console.log(`Specialist handoff ${valid ? 'VALID' : 'INVALID'}: ${result.handoffId ?? 'unknown'}`);
  console.log(`Domain owner validated: ${result.domainOwnerValidated}`);
  console.log(`Effect route bound: ${result.effectRouteBound}`);
  for (const error of errors) console.log(`ERROR ${error}`);
  for (const warning of warnings) console.log(`WARN ${warning}`);
  console.log('Execution authority: false');
}

if (args.strict && !valid) process.exitCode = 2;
