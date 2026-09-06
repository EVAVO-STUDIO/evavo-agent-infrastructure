#!/usr/bin/env node
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DEFAULT_CONFIG = resolve(ROOT, "config", "chatgpt-unified-capability-surface.v1.json");
const SELECTED_CONFIG = resolve(process.env.EVAVO_CHATGPT_CAPABILITY_SURFACE_CONFIG || DEFAULT_CONFIG);
const SUPPORTED_SCHEMA_VERSIONS = new Set([1, 2]);
const EXPECTED_KIND = "evavo-chatgpt-unified-capability-surface-v1";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

function readContract(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    fail("EVAVO ChatGPT capability surface contract is unavailable");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("EVAVO ChatGPT capability surface contract must be a regular non-symbolic file");
  }

  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail("EVAVO ChatGPT capability surface contract is invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("EVAVO ChatGPT capability surface contract must be an object");
  }
  if (
    !SUPPORTED_SCHEMA_VERSIONS.has(value.schemaVersion) ||
    value.kind !== EXPECTED_KIND ||
    value.status !== "canonical"
  ) {
    fail("EVAVO ChatGPT capability surface contract identity drifted");
  }
  return value;
}

const contract = readContract(SELECTED_CONFIG);
let compatibilityRoot = null;

if (contract.schemaVersion === 2) {
  // The current capability server predates schema v2 but consumes the same fields.
  // Preserve the complete canonical v2 contract and normalize only the loader-facing
  // schema discriminator until the server's internal parser is upgraded in place.
  compatibilityRoot = mkdtempSync(resolve(tmpdir(), "evavo-fabric-schema-compat-"));
  const compatibilityPath = resolve(compatibilityRoot, "surface.json");
  writeFileSync(
    compatibilityPath,
    `${JSON.stringify({ ...contract, schemaVersion: 1 }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  process.env.EVAVO_CHATGPT_CAPABILITY_SURFACE_CONFIG = compatibilityPath;
}

function cleanup() {
  if (!compatibilityRoot) return;
  try {
    rmSync(compatibilityRoot, { recursive: true, force: true });
  } catch {}
}

process.once("exit", cleanup);
process.once("SIGINT", cleanup);
process.once("SIGTERM", cleanup);

try {
  await import("./chatgpt-unified-capability-mcp.mjs");
} catch (error) {
  cleanup();
  throw error;
}
