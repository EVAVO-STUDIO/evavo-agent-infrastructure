import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { githubEstateRoutingMcpContract, githubEstateRoutingTools } from '../mcp-server/github-estate-routing-mcp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'mcp-server', 'github-estate-routing-mcp.mjs');
const NOW = '2026-08-29T00:00:00.000Z';
const names = githubEstateRoutingTools.map((tool) => tool.name);

async function temporary(run) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'evavo-estate-routing-mcp-'));
  try { return await run(root); } finally { await fsp.rm(root, { recursive: true, force: true }); }
}

async function fixture(root, variant = 'ok') {
  const snapshotRoot = path.join(root, 'snapshots');
  const trust = path.join(root, 'trust.json');
  const target = path.join(root, 'trust-target.json');
  const routing = path.join(root, 'routing.json');
  const cli = path.join(root, 'route.mjs');
  await fsp.mkdir(path.join(snapshotRoot, 'snapshot-1'), { recursive: true });
  await fsp.writeFile(target, '{"trust":true}\n');
  if (variant === 'symlink') await fsp.symlink(target, trust); else await fsp.copyFile(target, trust);
  await fsp.writeFile(routing, '{"routing":true}\n');
  await fsp.writeFile(cli, `#!/usr/bin/env node
import fs from 'node:fs';
const mode=process.argv[2],a=process.argv.slice(3),o={};
if(process.env.GITHUB_TOKEN||process.env.EVAVO_TEST_SECRET||process.env.NODE_OPTIONS)throw Error('secret');
for(let i=0;i<a.length;i++){const k=a[i].slice(2);if(k==='compact'){o[k]=true;continue;}o[k]=a[++i];}
if(${variant === 'stderr'} ){process.stderr.write('failed at '+o['snapshot-root']);process.exit(2);}
if(!fs.statSync(o['snapshot-root']).isDirectory()||!fs.statSync(o['trust-bundle']).isFile())throw Error('input');
const status={schemaVersion:1,kind:'evavo-agent-capability-status-v1',capturedAt:o.now,client:o.client,requestedCapabilities:['repository.inspect'],evidence:${variant === 'value-leak' ? "[{detail:o['snapshot-root']}]" : '[]'}${variant === 'field-leak' ? ",snapshotDirectory:o['snapshot-root']" : ''}};
const plan={schemaVersion:1,kind:'evavo-agent-capability-route-plan-v1',plannedAt:o.now,capturedAt:o.now,client:o.client,overallStatus:'ready',routingDigestSha256:'a'.repeat(64),statusDigestSha256:'b'.repeat(64),decisions:[],authority:{execution:false,sourceMutation:false,repositoryWrite:false,publication:false,providerMutation:false,credentialAccess:false},planDigestSha256:'c'.repeat(64)};
process.stdout.write(JSON.stringify(mode==='status'?status:plan)+'\\n');
`, { mode: 0o700 });
  return { snapshotRoot, trust, routing, cli };
}

function env(f = null) {
  return {
    ...process.env,
    GITHUB_TOKEN: 'secret-token',
    EVAVO_TEST_SECRET: 'secret-value',
    ...(f ? {
      EVAVO_GITHUB_ESTATE_SNAPSHOT_ROOT: f.snapshotRoot,
      EVAVO_GITHUB_ESTATE_TRUST_BUNDLE: f.trust,
      EVAVO_GITHUB_ESTATE_ROUTING_CONFIG: f.routing,
      EVAVO_GITHUB_ESTATE_ROUTING_CLI: f.cli,
      EVAVO_GITHUB_ESTATE_ROUTING_TIMEOUT_MS: '10000',
    } : {}),
  };
}

const init = () => JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{name:'test',version:'1'} } });
const call = (id, name, args={}) => JSON.stringify({ jsonrpc:'2.0', id, method:'tools/call', params:{ name, arguments:args } });

async function exchange(environment, messages) {
  const child = spawn(process.execPath, [SERVER], { cwd:ROOT, env:environment, stdio:['pipe','pipe','pipe'], windowsHide:true });
  let stdout='',stderr=''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data',(x)=>stdout+=x); child.stderr.on('data',(x)=>stderr+=x);
  const closed = new Promise((resolve,reject)=>{ child.once('error',reject); child.once('close',(code,signal)=>resolve({code,signal})); });
  for(const message of messages) child.stdin.write(message+'\n'); child.stdin.end();
  const timer = setTimeout(()=>child.kill('SIGKILL'),15000);
  const exit = await closed; clearTimeout(timer);
  return { ...exit, stdout, stderr, responses:stdout.split(/\r?\n/u).filter(Boolean).map(JSON.parse) };
}

function resultOf(exchange, id) { return exchange.responses.find((entry)=>entry.id===id)?.result; }

test('catalog is a three-tool read-only surface without caller-selected paths or commands', () => {
  assert.equal(githubEstateRoutingMcpContract.serverName, 'evavo-github-estate-routing');
  assert.deepEqual(names, ['evavo_github_estate_routing_readiness','evavo_github_estate_routing_status','evavo_github_estate_routing_plan']);
  for (const tool of githubEstateRoutingTools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(Object.keys(tool.inputSchema.properties).some((key)=>/(?:path|root|bundle|command|endpoint|executable)/iu.test(key)), false);
  }
});

test('readiness is bounded and never upgrades presence into verification', async () => {
  const x = await exchange(env(), [init(), call(2,names[0])]);
  assert.equal(x.code,0); assert.equal(x.stderr,'');
  const report=resultOf(x,2).structuredContent;
  assert.equal(report.status,'blocked'); assert.equal(report.runtimeVerificationPerformed,false); assert.equal(report.mayClaimEvidenceValid,false);
  assert.doesNotMatch(JSON.stringify(report),/(?:secret-|[A-Za-z]:\\|\/mnt\/|\/home\/|\/tmp\/)/u);
});

test('configured MCP lists exact tools and returns bounded status and all-false plan', async () => temporary(async (root) => {
  const f=await fixture(root), x=await exchange(env(f),[init(),JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}}),call(3,names[0]),call(4,names[1],{client:'chatgpt-pro',now:NOW}),call(5,names[2],{client:'claude-code',now:NOW})]);
  assert.equal(x.code,0); assert.equal(x.stderr,''); assert.deepEqual(resultOf(x,2).tools.map((tool)=>tool.name),names);
  assert.equal(resultOf(x,3).structuredContent.status,'configured');
  assert.equal(resultOf(x,4).structuredContent.kind,'evavo-agent-capability-status-v1');
  const plan=resultOf(x,5).structuredContent; assert.equal(plan.kind,'evavo-agent-capability-route-plan-v1'); assert.ok(Object.values(plan.authority).every((value)=>value===false));
  assert.doesNotMatch(x.stdout,/secret-token|secret-value/u);
}));

test('invalid requests, unsafe files and leaked child output fail closed with redacted errors', async () => temporary(async (root) => {
  const good=await fixture(path.join(root,'good'));
  let x=await exchange(env(good),[init(),call(2,names[1],{client:'unknown'}),call(3,names[0],{path:'/tmp/x'}),call(4,'unknown')]);
  for(const id of [2,3,4]) assert.equal(resultOf(x,id).isError,true);
  x=await exchange(env(good),[init(),'{"jsonrpc":"2.0","id":8,"method":"ping","method":"tools/list"}','{"jsonrpc":"2.0","id":9,"method":"ping","__proto__":{}}']);
  assert.equal(x.responses.filter((entry)=>entry.error?.code===-32700).length,2);

  const linked=await fixture(path.join(root,'linked'),'symlink');
  x=await exchange(env(linked),[init(),call(10,names[1],{client:'chatgpt-pro',now:NOW})]);
  assert.equal(resultOf(x,10).isError,true);

  for(const variant of ['field-leak','value-leak','stderr']) {
    const f=await fixture(path.join(root,variant),variant);
    x=await exchange(env(f),[init(),call(11,names[1],{client:'chatgpt-pro',now:NOW})]);
    const message=resultOf(x,11).content[0].text;
    assert.equal(resultOf(x,11).isError,true);
    assert.doesNotMatch(message,new RegExp(f.snapshotRoot.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&'),'u'));
    if(variant==='stderr') assert.match(message,/stderrBytes=|ROUTE_FAILED/u);
  }
}));

test('workspace package and example config register the bounded runtime', async () => {
  const packageJson=JSON.parse(await fsp.readFile(path.join(ROOT,'mcp-server','package.json'),'utf8'));
  assert.match(packageJson.scripts['check:local-runtimes'],/github-estate-routing-mcp\.mjs/u);
  assert.match(packageJson.scripts.test,/github-estate-routing-mcp\.test\.mjs/u);
  const example=JSON.parse(await fsp.readFile(path.join(ROOT,'config','mcp.github-estate-routing.example.json'),'utf8'));
  const server=example.mcpServers['evavo-github-estate-routing'];
  assert.deepEqual(server.args,['C:\\GitRepos\\evavo-agent-infrastructure\\mcp-server\\github-estate-routing-mcp.mjs']);
  assert.equal(Object.keys(server.env).some((key)=>/(?:TOKEN|SECRET|PASSWORD|KEY)$/u.test(key)),false);
});
