import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  repositoryTaskMcpContract,
  repositoryTaskTools,
} from '../mcp-server/repository-task-core.mjs';

const names = repositoryTaskTools.map((tool) => tool.name);

test('repository task MCP exposes catalogue, describe, plan and exact run only', () => {
  assert.deepEqual(names, [
    'evavo_repository_task_catalog',
    'evavo_repository_task_describe',
    'evavo_repository_task_plan',
    'evavo_repository_task_run',
  ]);
  assert.equal(repositoryTaskMcpContract.fragmentAware, true);
  assert.equal(repositoryTaskMcpContract.catalogueDiscovery, true);
  assert.equal(repositoryTaskMcpContract.callerExecutableAllowed, false);
  assert.equal(repositoryTaskMcpContract.callerScriptAllowed, false);
  assert.equal(repositoryTaskMcpContract.callerArgvAllowed, false);
  assert.equal(repositoryTaskMcpContract.callerEnvironmentAllowed, false);
  assert.equal(repositoryTaskMcpContract.physicalPathsReturned, false);
});

test('catalogue schema is bounded and has no execution authority', () => {
  const catalog = repositoryTaskTools.find((tool) => tool.name === 'evavo_repository_task_catalog');
  assert.ok(catalog);
  assert.deepEqual(catalog.inputSchema.required, ['repository']);
  assert.equal(catalog.inputSchema.properties.limit.maximum, 500);
  assert.equal(catalog.inputSchema.properties.query.maxLength, 256);
  for (const forbidden of ['executable', 'script', 'argv', 'environment', 'cwd', 'shell', 'parameters']) {
    assert.equal(Object.hasOwn(catalog.inputSchema.properties, forbidden), false);
  }
});

test('run schema requires the exact planned repository state and task identity', () => {
  const run = repositoryTaskTools.find((tool) => tool.name === 'evavo_repository_task_run');
  assert.ok(run);
  assert.deepEqual(run.inputSchema.required, [
    'repository',
    'taskName',
    'expectedHeadSha',
    'expectedStatusSha256',
    'expectedTaskManifestSha256',
    'expectedTaskSha256',
  ]);
  const properties = run.inputSchema.properties;
  for (const forbidden of ['executable', 'script', 'argv', 'environment', 'cwd', 'shell']) {
    assert.equal(Object.hasOwn(properties, forbidden), false);
  }
});

test('parameterized execution retains the plan SHA handshake', async () => {
  const source = await readFile(new URL('../mcp-server/repository-task-core.mjs', import.meta.url), 'utf8');
  assert.match(source, /expectedParameterSha256/u);
  assert.match(source, /evavo_repository_task_invocation_v2/u);
  assert.match(source, /repository_task_catalog_current/u);
  assert.match(source, /repository_task_plan_current/u);
  assert.match(source, /repository_task_current/u);
  assert.match(source, /EVAVO_NETWORK_POLICY: 'disabled'/u);
  assert.match(source, /shell: false/u);
  assert.match(source, /PYTHONPATH: join\(LOCAL_STORAGE_ROOT, 'src'\)/u);
});

test('registered MCP uses receiver-owned Local Storage and Git roots', async () => {
  const manifest = JSON.parse(await readFile(new URL('../.mcp.json', import.meta.url), 'utf8'));
  const server = manifest.mcpServers['evavo-repository-task'];
  assert.ok(server);
  assert.equal(server.command, 'node');
  assert.deepEqual(server.args, ['./mcp-server/repository-task-mcp.mjs']);
  assert.equal(server.env.EVAVO_LOCAL_STORAGE_ROOT, 'C:\\GitRepos\\evavo-local-storage');
  assert.equal(server.env.EVAVO_GIT_WORKSPACE, 'C:\\GitRepos');
});

test('temporary parameter and invocation files are create-only and removed', async () => {
  const source = await readFile(new URL('../mcp-server/repository-task-core.mjs', import.meta.url), 'utf8');
  assert.match(source, /flag: 'wx'/u);
  assert.match(source, /mode: 0o600/u);
  assert.match(source, /rm\(directory, \{ recursive: true, force: true \}\)/u);
  assert.match(source, /MAX_PARAMETERS_BYTES = 256 \* 1024/u);
});
