import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const LOCAL_STORAGE_ROOT = (process.env.EVAVO_LOCAL_STORAGE_ROOT ?? process.env.EVAVO_LOCAL_STORAGE_REPO ?? 'C:\\GitRepos\\evavo-local-storage').trim();
const GIT_ROOT = (process.env.EVAVO_GIT_WORKSPACE ?? process.env.EVAVO_GIT_ROOT ?? 'C:\\GitRepos').trim();
const PYTHON = (process.env.EVAVO_REPOSITORY_TASK_PYTHON ?? 'python.exe').trim();
const LOCAL_STORAGE_CONFIG = (process.env.EVAVO_LOCAL_STORAGE_CONFIG ?? '').trim();
const REPOSITORY = /^EVAVO-STUDIO\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
const TASK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_PARAMETERS_BYTES = 256 * 1024;
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const runEnv = () => ({
  ...process.env,
  PYTHONPATH: join(LOCAL_STORAGE_ROOT, 'src'),
  EVAVO_GIT_WORKSPACE: GIT_ROOT,
  EVAVO_NETWORK_POLICY: 'disabled',
});

export const repositoryTaskMcpContract = Object.freeze({
  schemaVersion: 1,
  kind: 'evavo-repository-task-mcp-contract-v1',
  serverName: 'evavo-repository-task',
  serverVersion: '1.0.0',
  localStorageAuthority: true,
  fragmentAware: true,
  callerExecutableAllowed: false,
  callerScriptAllowed: false,
  callerArgvAllowed: false,
  callerEnvironmentAllowed: false,
  physicalPathsReturned: false,
});

export const repositoryTaskTools = Object.freeze([
  {
    name: 'evavo_repository_task_describe',
    description: 'Describe one exact governed EVAVO named repository task, including fragment-defined tasks, without executing it. Returns the parameter schema and manifest-set-bound task identity; no physical paths are returned.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['repository', 'taskName'],
      properties: {
        repository: { type: 'string', pattern: '^EVAVO-STUDIO/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' },
        taskName: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' },
      },
    },
  },
  {
    name: 'evavo_repository_task_plan',
    description: 'Plan one exact named task with its structured parameters. Local Storage resolves logical compute-path URIs internally and returns the exact head/status/manifest/task/parameter bindings required for execution. Performs no task execution.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['repository', 'taskName'],
      properties: {
        repository: { type: 'string', pattern: '^EVAVO-STUDIO/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' },
        taskName: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' },
        parameters: { type: 'object', additionalProperties: true },
      },
    },
  },
  {
    name: 'evavo_repository_task_run',
    description: 'Execute one exact previously planned governed named task. The caller supplies only repository/task identity, the same structured parameters, and exact plan digests. No executable, script, argv, shell, environment or physical path authority is accepted.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      required: ['repository', 'taskName', 'expectedHeadSha', 'expectedStatusSha256', 'expectedTaskManifestSha256', 'expectedTaskSha256'],
      properties: {
        repository: { type: 'string', pattern: '^EVAVO-STUDIO/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' },
        taskName: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' },
        expectedHeadSha: { type: 'string', pattern: '^[0-9a-f]{40}$' },
        expectedStatusSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        expectedTaskManifestSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        expectedTaskSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        parameters: { type: 'object', additionalProperties: true },
        expectedParameterSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        maximumOutputBytes: { type: 'integer', minimum: 10000, maximum: 8388608 },
      },
    },
  },
]);

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('arguments must be an object');
  return value;
}
function identity(args) {
  const repository = String(args.repository ?? '');
  const taskName = String(args.taskName ?? '');
  if (!REPOSITORY.test(repository) || !TASK.test(taskName)) throw new Error('repository/task identity is invalid');
  return { repository, taskName };
}
function jsonBytes(value) {
  const text = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(text, 'utf8') > MAX_PARAMETERS_BYTES) throw new Error('structured parameters exceed 256 KiB');
  return text;
}
async function pythonModule(moduleName, argv, timeout) {
  const fullArgs = ['-B', '-m', moduleName, ...argv];
  const { stdout, stderr } = await execFileAsync(PYTHON, fullArgs, {
    cwd: LOCAL_STORAGE_ROOT,
    env: runEnv(),
    windowsHide: true,
    shell: false,
    timeout,
    maxBuffer: MAX_STDOUT_BYTES,
    encoding: 'utf8',
  });
  if (stderr?.trim()) {
    // Successful CLIs are expected to keep stderr empty; do not expose unbounded diagnostics.
    throw new Error(`Local Storage repository-task CLI returned stderr: ${stderr.trim().slice(-2000)}`);
  }
  let result;
  try { result = object(JSON.parse(stdout)); }
  catch { throw new Error('Local Storage repository-task CLI returned invalid JSON'); }
  if (result.physicalPathsReturned === true || result.truthBoundary?.physicalPathsReturned === true) throw new Error('repository-task surface attempted to return physical paths');
  return result;
}
async function withTemporaryJson(value, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'evavo-repository-task-'));
  const path = join(directory, 'input.json');
  try {
    await writeFile(path, jsonBytes(value), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return await callback(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function describe(raw) {
  const args = object(raw); const { repository, taskName } = identity(args);
  if (Object.keys(args).some((key) => !['repository', 'taskName'].includes(key))) throw new Error('unsupported describe field');
  const argv = ['--repository', repository, '--task', taskName, '--git-root', GIT_ROOT];
  return pythonModule('evavo_local_storage.repository_task_descriptor_current', argv, 60000);
}
async function plan(raw) {
  const args = object(raw); const { repository, taskName } = identity(args);
  if (Object.keys(args).some((key) => !['repository', 'taskName', 'parameters'].includes(key))) throw new Error('unsupported plan field');
  const base = ['--repository', repository, '--task', taskName, '--git-root', GIT_ROOT];
  if (LOCAL_STORAGE_CONFIG) base.push('--config', LOCAL_STORAGE_CONFIG);
  if (!Object.hasOwn(args, 'parameters')) return pythonModule('evavo_local_storage.repository_task_plan_current', base, 60000);
  const parameters = object(args.parameters);
  return withTemporaryJson(parameters, (path) => pythonModule('evavo_local_storage.repository_task_plan_current', [...base, '--parameters-file', path], 60000));
}
function validateRun(raw) {
  const args = object(raw); const id = identity(args);
  const allowed = new Set(['repository','taskName','expectedHeadSha','expectedStatusSha256','expectedTaskManifestSha256','expectedTaskSha256','parameters','expectedParameterSha256','maximumOutputBytes']);
  if (Object.keys(args).some((key) => !allowed.has(key))) throw new Error('unsupported run field');
  if (!SHA1.test(String(args.expectedHeadSha ?? ''))) throw new Error('expectedHeadSha is invalid');
  for (const key of ['expectedStatusSha256','expectedTaskManifestSha256','expectedTaskSha256']) if (!SHA256.test(String(args[key] ?? ''))) throw new Error(`${key} is invalid`);
  if (Object.hasOwn(args, 'expectedParameterSha256') && !SHA256.test(String(args.expectedParameterSha256 ?? ''))) throw new Error('expectedParameterSha256 is invalid');
  if (Object.hasOwn(args, 'parameters')) object(args.parameters);
  if (Object.hasOwn(args, 'maximumOutputBytes')) {
    const value = Number(args.maximumOutputBytes);
    if (!Number.isInteger(value) || value < 10000 || value > MAX_STDOUT_BYTES) throw new Error('maximumOutputBytes is outside bounds');
  }
  return id;
}
async function run(raw) {
  const args = object(raw); validateRun(args);
  const invocation = { contractVersion: 'evavo_repository_task_invocation_v2', ...args };
  return withTemporaryJson(invocation, (path) => {
    const argv = ['--invocation', path, '--git-root', GIT_ROOT];
    if (LOCAL_STORAGE_CONFIG) argv.push('--config', LOCAL_STORAGE_CONFIG);
    return pythonModule('evavo_local_storage.repository_task_current', argv, 7_215_000);
  });
}

export async function callRepositoryTaskTool(name, raw = {}) {
  if (name === 'evavo_repository_task_describe') return describe(raw);
  if (name === 'evavo_repository_task_plan') return plan(raw);
  if (name === 'evavo_repository_task_run') return run(raw);
  throw new Error(`unknown repository-task tool: ${name}`);
}
