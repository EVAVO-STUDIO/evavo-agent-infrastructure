import { createHash } from 'node:crypto';
import fs from 'node:fs';

export const ESTATE_SNAPSHOT_KIND = 'evavo-repository-estate-governance-snapshot-v1';
export const ESTATE_SNAPSHOT_INDEX_KIND =
  'evavo-repository-estate-governance-snapshot-index-v1';
export const ESTATE_ROUTING_VERIFICATION_KIND =
  'evavo-github-estate-routing-verification-v1';
export const AGENT_CAPABILITY_STATUS_KIND = 'evavo-agent-capability-status-v1';
export const ESTATE_SNAPSHOT_ATTESTATION_SCHEMA =
  'evavo_repository_estate_snapshot_attestation_v1';
export const ESTATE_SNAPSHOT_ATTESTATION_TRUST_SCHEMA =
  'evavo_repository_estate_snapshot_attestation_trust_v1';
export const ESTATE_SNAPSHOT_ATTESTATION_SIGNING_DOMAIN =
  'EVAVO:GITHUB-MCP:ESTATE-SNAPSHOT:V1\n';
export const ESTATE_SNAPSHOT_ATTESTOR_SYSTEM_ID =
  'evavo-github-estate-snapshot';
export const ESTATE_SNAPSHOT_SOURCE_REPOSITORY =
  'EVAVO-STUDIO/evavo-github-mcp';
export const ESTATE_SNAPSHOT_ATTESTATION_FILE = 'snapshot-attestation.json';
export const ROUTING_STRATEGY_ID = 'repository-inspect-connected-github';
export const ROUTING_CAPABILITY_ID = 'repository.inspect';

export const EXPECTED_FILES = Object.freeze([
  'estate-manifest.json',
  'estate-selection.json',
  'inventory.json',
  'provider-audit.json',
  'provider-observations.json',
]);
export const EXPECTED_DIRECTORY_FILES = Object.freeze([
  ...EXPECTED_FILES,
  'snapshot-index.json',
  ESTATE_SNAPSHOT_ATTESTATION_FILE,
]);
export const ROUTING_CLIENTS = new Set([
  'chatgpt-pro',
  'claude-code',
  'codex',
  'api-agent',
]);
export const SNAPSHOT_INTENTS = new Set(['review', 'mutation', 'publication']);
export const SHA1_PATTERN = /^[0-9a-f]{40}$/u;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
export const PREFIXED_SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
export const KEY_ID_PATTERN = /^evavo-github-estate-snapshot:[0-9a-f]{24}$/u;
export const DIRECTORY_PATTERN = /^estate-(\d{8}T\d{9}Z)-([0-9a-f]{20})$/u;
export const MAX_JSON_BYTES = 16 * 1024 * 1024;
export const MAX_INDEX_BYTES = 1024 * 1024;
export const MAX_TRUST_BYTES = 1024 * 1024;
export const MAX_ATTESTATION_BYTES = 1024 * 1024;
export const MAX_ATTESTATION_LAG_MS = 10 * 60_000;
export const MAX_JSON_DEPTH = 64;
export const MAX_JSON_NODES = 250_000;
export const MAX_CLOCK_SKEW_MS = 120_000;
export const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function fail(code, detail = '') {
  throw new Error(detail ? `${code}: ${detail}` : code);
}

export function assert(condition, code, detail = '') {
  if (!condition) fail(code, detail);
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function exactKeys(value, required, optional, code) {
  assert(isRecord(value), code, 'expected object');
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  assert(missing.length === 0, code, `missing=${missing.join(',')}`);
  assert(unknown.length === 0, code, `unknown=${unknown.join(',')}`);
}

export function text(value, code, { maximum = 4096, pattern, allowEmpty = false } = {}) {
  assert(
    typeof value === 'string' &&
      value.length <= maximum &&
      (allowEmpty || value.length > 0) &&
      value.trim() === value &&
      !/[\u0000-\u001f\u007f]/u.test(value),
    code,
  );
  if (pattern) assert(pattern.test(value), code, value);
  return value;
}


export function integer(value, code, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  assert(Number.isSafeInteger(value) && value >= minimum && value <= maximum, code);
  return value;
}

export function pemText(value, code) {
  assert(
    typeof value === 'string' &&
      value.length >= 64 &&
      value.length <= 8192 &&
      !/[\u0000]/u.test(value) &&
      /-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----/u.test(value),
    code,
  );
  return value;
}

export function canonicalInstant(value, code) {
  const result = text(value, code, { maximum: 64 });
  const milliseconds = Date.parse(result);
  assert(Number.isFinite(milliseconds), code, result);
  assert(new Date(milliseconds).toISOString() === result, code, 'must be canonical UTC');
  return Object.freeze({ text: result, milliseconds });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function digestJson(value) {
  return `sha256:${sha256Bytes(Buffer.from(canonicalJson(value), 'utf8'))}`;
}

export function falseAuthority(value, code) {
  exactKeys(
    value,
    [
      'providerRead',
      'providerMutation',
      'sourceMutation',
      'repositoryWrite',
      'publication',
      'execution',
      'credentialAccess',
    ],
    [],
    code,
  );
  assert(Object.values(value).every((entry) => entry === false), code);
  return value;
}

export function authority() {
  return Object.freeze({
    providerRead: false,
    providerMutation: false,
    sourceMutation: false,
    repositoryWrite: false,
    publication: false,
    execution: false,
    credentialAccess: false,
  });
}

class StrictJsonParser {
  constructor(source) {
    this.source = source;
    this.index = 0;
    this.depth = 0;
    this.nodes = 0;
  }

  parse() {
    this.#space();
    const value = this.#value();
    this.#space();
    if (this.index !== this.source.length) this.#fail('trailing data');
    return value;
  }

  #fail(message) {
    fail('EVAVO_ESTATE_ROUTING_JSON', `${message} at offset ${String(this.index)}`);
  }

  #peek() {
    return this.source[this.index];
  }

  #space() {
    while (/[ \t\r\n]/u.test(this.#peek() ?? '')) this.index += 1;
  }

  #node() {
    this.nodes += 1;
    if (this.nodes > MAX_JSON_NODES) this.#fail('node limit exceeded');
  }

  #enter() {
    this.depth += 1;
    if (this.depth > MAX_JSON_DEPTH) this.#fail('depth limit exceeded');
  }

  #leave() {
    this.depth -= 1;
  }

  #value() {
    this.#node();
    const current = this.#peek();
    if (current === '{') return this.#object();
    if (current === '[') return this.#array();
    if (current === '"') return this.#string();
    if (current === 't') return this.#literal('true', true);
    if (current === 'f') return this.#literal('false', false);
    if (current === 'n') return this.#literal('null', null);
    if (current === '-' || /[0-9]/u.test(current ?? '')) return this.#number();
    this.#fail('invalid value');
  }

  #literal(source, value) {
    if (this.source.slice(this.index, this.index + source.length) !== source) {
      this.#fail('invalid literal');
    }
    this.index += source.length;
    return value;
  }

  #string() {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === '"') {
        this.index += 1;
        try {
          return JSON.parse(this.source.slice(start, this.index));
        } catch {
          this.#fail('invalid string');
        }
      }
      if (character === '\\') {
        this.index += 1;
        const escaped = this.source[this.index];
        if (escaped === 'u') {
          const hex = this.source.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(hex)) this.#fail('invalid unicode escape');
          this.index += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(escaped ?? '')) this.#fail('invalid escape');
        this.index += 1;
        continue;
      }
      if ((character?.charCodeAt(0) ?? 0) < 0x20) this.#fail('control character');
      this.index += 1;
    }
    this.#fail('unterminated string');
  }

  #number() {
    const match = this.source
      .slice(this.index)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u);
    if (!match) this.#fail('invalid number');
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.#fail('non-finite number');
    return value;
  }

  #array() {
    this.#enter();
    const result = [];
    this.index += 1;
    this.#space();
    if (this.#peek() === ']') {
      this.index += 1;
      this.#leave();
      return result;
    }
    for (;;) {
      this.#space();
      result.push(this.#value());
      this.#space();
      if (this.#peek() === ']') {
        this.index += 1;
        this.#leave();
        return result;
      }
      if (this.#peek() !== ',') this.#fail('expected comma in array');
      this.index += 1;
    }
  }

  #object() {
    this.#enter();
    const result = {};
    const keys = new Set();
    this.index += 1;
    this.#space();
    if (this.#peek() === '}') {
      this.index += 1;
      this.#leave();
      return result;
    }
    for (;;) {
      this.#space();
      if (this.#peek() !== '"') this.#fail('expected object key');
      const key = this.#string();
      if (keys.has(key)) fail('EVAVO_ESTATE_ROUTING_JSON_DUPLICATE_KEY', key);
      if (FORBIDDEN_KEYS.has(key)) fail('EVAVO_ESTATE_ROUTING_JSON_PROHIBITED_KEY', key);
      keys.add(key);
      this.#space();
      if (this.#peek() !== ':') this.#fail('expected colon');
      this.index += 1;
      this.#space();
      Object.defineProperty(result, key, {
        value: this.#value(),
        enumerable: true,
        configurable: true,
        writable: true,
      });
      this.#space();
      if (this.#peek() === '}') {
        this.index += 1;
        this.#leave();
        return result;
      }
      if (this.#peek() !== ',') this.#fail('expected comma in object');
      this.index += 1;
    }
  }
}

export function parseStrictJson(source, maximumBytes = MAX_JSON_BYTES) {
  assert(typeof source === 'string', 'EVAVO_ESTATE_ROUTING_JSON_SOURCE');
  assert(
    Buffer.byteLength(source, 'utf8') <= maximumBytes,
    'EVAVO_ESTATE_ROUTING_JSON_BYTES',
  );
  return new StrictJsonParser(source).parse();
}

export function readRegularFile(filePath, maximumBytes, code) {
  const stat = fs.lstatSync(filePath);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${code}_TYPE`, filePath);
  assert(stat.size > 0 && stat.size <= maximumBytes, `${code}_BYTES`, filePath);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const before = fs.fstatSync(descriptor);
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    assert(
      before.dev === after.dev &&
        before.ino === after.ino &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs,
      `${code}_CHANGED`,
      filePath,
    );
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

export function readCanonicalJsonFile(filePath, maximumBytes, code) {
  const bytes = readRegularFile(filePath, maximumBytes, code);
  const value = parseStrictJson(bytes.toString('utf8').replace(/^\uFEFF/u, ''), maximumBytes);
  const canonical = Buffer.from(canonicalJson(value), 'utf8');
  assert(bytes.equals(canonical), `${code}_NON_CANONICAL`, filePath);
  return Object.freeze({ bytes, value });
}

