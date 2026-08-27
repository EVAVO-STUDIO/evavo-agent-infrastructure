#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function regularFile(candidate) {
  try {
    const value = lstatSync(candidate);
    return value.isFile() && !value.isSymbolicLink();
  } catch {
    return false;
  }
}

function directory(candidate) {
  try {
    const value = lstatSync(candidate);
    return value.isDirectory() && !value.isSymbolicLink();
  } catch {
    return false;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => resolve(String(value))))];
}

function resolveLocalCompute() {
  const roots = unique([
    process.env.EVAVO_LOCAL_COMPUTE_ROOT,
    process.env.EVAVO_GIT_REPOS_ROOT && join(process.env.EVAVO_GIT_REPOS_ROOT, 'evavo-local-compute'),
    resolve(here, '..', '..', 'evavo-local-compute'),
    process.platform === 'win32' ? 'C:\\GitRepos\\evavo-local-compute' : null,
  ]);
  for (const root of roots) {
    if (!directory(root)) continue;
    const launcher = join(root, 'scripts', 'windows-workstation-operator-mcp.py');
    const operator = join(root, 'src', 'evavo_local_compute', 'windows_workstation_operator.py');
    if (regularFile(launcher) && regularFile(operator)) {
      return { root, launcher };
    }
  }
  throw new Error('EVAVO_WORKSTATION_OPERATOR_SOURCE_UNAVAILABLE');
}

function pythonCandidates() {
  const values = [];
  if (process.env.EVAVO_PYTHON) values.push(process.env.EVAVO_PYTHON);
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    values.push(join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python312', 'python.exe'));
  }
  values.push(process.platform === 'win32' ? 'python.exe' : 'python3');
  return values;
}

function startWith(candidate, operator) {
  return new Promise((resolveStart, rejectStart) => {
    const child = spawn(candidate, [operator.launcher], {
      cwd: operator.root,
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
      },
      stdio: 'inherit',
      windowsHide: true,
      shell: false,
    });
    let settled = false;
    child.once('spawn', () => {
      settled = true;
      for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => {
          if (!child.killed) child.kill(signal);
        });
      }
      child.once('exit', (code, signal) => {
        if (signal) process.kill(process.pid, signal);
        process.exit(Number.isInteger(code) ? code : 1);
      });
      resolveStart(child);
    });
    child.once('error', (error) => {
      if (!settled) rejectStart(error);
    });
  });
}

async function main() {
  const operator = resolveLocalCompute();
  let lastError = null;
  for (const candidate of pythonCandidates()) {
    try {
      await startWith(candidate, operator);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('EVAVO_PYTHON_312_UNAVAILABLE');
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      schemaVersion: 1,
      kind: 'evavo-windows-workstation-operator-compatibility-error-v1',
      ok: false,
      errorCode: String(error?.message || 'EVAVO_WORKSTATION_OPERATOR_COMPATIBILITY_FAILED'),
      credentialValuesReturned: false,
      physicalPathsReturned: false,
    })}\n`,
  );
  process.exit(1);
});
