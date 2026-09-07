#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const args = { pattern: null, domains: [], json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--pattern') args.pattern = argv[++i] ?? null;
    else if (token === '--domain') args.domains.push(argv[++i] ?? '');
    else if (token === '--json') args.json = true;
    else if (token === '--help' || token === '-h') {
      console.log('Usage: node scripts/Plan-EvavoSpecialistTeam.mjs [--pattern <id>] [--domain <domain>]... [--json]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${token}`);
  }
  args.domains = args.domains.filter(Boolean);
  if (!args.pattern && args.domains.length === 0) throw new Error('Provide --pattern or at least one --domain');
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function buildPlan({ patternId, domains, configDir }) {
  const handoffs = readJson(path.join(configDir, 'specialist-handoff-graph-v1.json'));
  const ownersDoc = readJson(path.join(configDir, 'specialist-domain-owners-v1.json'));
  const owners = ownersDoc?.owners ?? {};
  const requestedDomains = [...new Set(domains.map(normalize).filter(Boolean))];

  let selected = null;
  let ranking = [];

  if (patternId) {
    selected = (handoffs?.patterns ?? []).find((pattern) => pattern?.id === patternId) ?? null;
    if (!selected) throw new Error(`Unknown handoff pattern: ${patternId}`);
  } else {
    ranking = (handoffs?.patterns ?? []).map((pattern) => {
      const specialistIds = new Set((pattern?.sequence ?? []).map((step) => step?.specialist).filter(Boolean));
      const patternDomains = new Set();
      for (const specialistId of specialistIds) {
        for (const domain of owners[specialistId]?.domains ?? []) patternDomains.add(normalize(domain));
      }
      const matchedDomains = requestedDomains.filter((domain) => patternDomains.has(domain));
      return {
        patternId: pattern.id,
        goal: pattern.goal,
        score: matchedDomains.length,
        matchedDomains
      };
    }).sort((a, b) => b.score - a.score || a.patternId.localeCompare(b.patternId));
    selected = (handoffs?.patterns ?? []).find((pattern) => pattern?.id === ranking[0]?.patternId) ?? null;
  }

  if (!selected) throw new Error('No specialist team pattern could be selected');

  const team = (selected.sequence ?? []).map((step, index) => {
    const owner = owners[step.specialist] ?? null;
    return {
      order: index + 1,
      specialistId: step.specialist,
      repository: owner?.repository ?? null,
      domains: owner?.domains ?? [],
      ownerStatus: owner?.status ?? 'declared',
      role: step.role,
      sourceResolved: owner?.status !== 'source-unresolved'
    };
  });

  const unresolved = team.filter((member) => !member.repository || member.sourceResolved === false);
  return {
    schemaVersion: 1,
    kind: 'evavo-specialist-team-plan-v1',
    selectedPattern: selected.id,
    goal: selected.goal,
    knownBoundary: selected.knownBoundary ?? null,
    blockedUntil: selected.blockedUntil ?? null,
    requestedDomains,
    ranking,
    team,
    unresolved,
    executionAuthorized: false,
    handoffRequired: team.length > 1,
    nextStep: unresolved.length
      ? 'Resolve the listed specialist source/ownership blockers before effectful handoff.'
      : 'Resolve capability-specific authority and route readiness for each effectful team step before execution.'
  };
}

const args = parseArgs(process.argv.slice(2));
const repoDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))), '..');
const result = buildPlan({ patternId: args.pattern, domains: args.domains, configDir: path.join(repoDir, 'config') });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
