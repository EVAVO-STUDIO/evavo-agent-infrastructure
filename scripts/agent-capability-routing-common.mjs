import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ROUTING_KIND = 'evavo-agent-capability-routing-v1';
export const STATUS_KIND = 'evavo-agent-capability-status-v1';
export const PLAN_KIND = 'evavo-agent-capability-route-plan-v1';

export const ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
export const REPOSITORY_PATTERN = /^EVAVO-STUDIO\/[A-Za-z0-9._-]+$/u;
export const SHA_PATTERN = /^[0-9a-f]{40}$/u;
export const EFFECTS = new Set(['read', 'write', 'execute', 'control', 'publish']);
export const TRUTH_STATES = Object.freeze([
  'source_ready',
  'configured',
  'transport_online',
  'accepted',
  'completed',
  'physically_verified',
]);
export const STATE_LEVEL = new Map(TRUTH_STATES.map((state, index) => [state, index]));
export const FORBIDDEN_HOSTED_EXECUTION = /(?:github[-_ ]?actions|vercel)/iu;

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

export function text(value, code, { minimum = 1, maximum = 1024, pattern } = {}) {
  assert(
    typeof value === 'string' &&
      value.length >= minimum &&
      value.length <= maximum &&
      value.trim() === value &&
      !/[\u0000-\u001f\u007f]/u.test(value),
    code,
  );
  if (pattern) assert(pattern.test(value), code, value);
  return value;
}

export function id(value, code) {
  return text(value, code, { maximum: 128, pattern: ID_PATTERN });
}

export function integer(value, code, minimum, maximum) {
  assert(Number.isInteger(value) && value >= minimum && value <= maximum, code);
  return value;
}

export function bool(value, code) {
  assert(typeof value === 'boolean', code);
  return value;
}

export function isoInstant(value, code) {
  const result = text(value, code, { maximum: 64 });
  const milliseconds = Date.parse(result);
  assert(Number.isFinite(milliseconds), code, result);
  assert(new Date(milliseconds).toISOString() === result, code, 'must be canonical ISO-8601 UTC');
  return milliseconds;
}

export function uniqueStrings(value, code, { minimum = 1, maximum = 128, validate = id } = {}) {
  assert(Array.isArray(value) && value.length >= minimum && value.length <= maximum, code);
  const result = value.map((entry, index) => validate(entry, `${code}[${index}]`));
  assert(new Set(result).size === result.length, code, 'duplicates');
  return result;
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

export function sha256Json(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

class StrictJsonParser {
  constructor(source, maximumDepth, maximumNodes) {
    this.source = source;
    this.index = 0;
    this.depth = 0;
    this.nodes = 0;
    this.maximumDepth = maximumDepth;
    this.maximumNodes = maximumNodes;
  }

  parse() {
    this.#space();
    const value = this.#value();
    this.#space();
    if (this.index !== this.source.length) this.#fail('trailing JSON data');
    return value;
  }

  #fail(message) {
    fail('EVAVO_AGENT_ROUTING_JSON', `${message} at offset ${String(this.index)}`);
  }

  #peek() {
    return this.source[this.index];
  }

  #space() {
    while (/[ \t\r\n]/u.test(this.#peek() ?? '')) this.index += 1;
  }

  #node() {
    this.nodes += 1;
    if (this.nodes > this.maximumNodes) this.#fail('node limit exceeded');
  }

  #enter() {
    this.depth += 1;
    if (this.depth > this.maximumDepth) this.#fail('depth limit exceeded');
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
      if ((character?.charCodeAt(0) ?? 0) < 0x20) this.#fail('control character in string');
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
      const delimiter = this.#peek();
      if (delimiter === ']') {
        this.index += 1;
        this.#leave();
        return result;
      }
      if (delimiter !== ',') this.#fail('expected comma in array');
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
      if (keys.has(key)) fail('EVAVO_AGENT_ROUTING_JSON_DUPLICATE_KEY', key);
      if (['__proto__', 'constructor', 'prototype'].includes(key)) {
        fail('EVAVO_AGENT_ROUTING_JSON_PROHIBITED_KEY', key);
      }
      keys.add(key);
      this.#space();
      if (this.#peek() !== ':') this.#fail('expected colon after key');
      this.index += 1;
      this.#space();
      Object.defineProperty(result, key, {
        value: this.#value(),
        enumerable: true,
        configurable: true,
        writable: true,
      });
      this.#space();
      const delimiter = this.#peek();
      if (delimiter === '}') {
        this.index += 1;
        this.#leave();
        return result;
      }
      if (delimiter !== ',') this.#fail('expected comma in object');
      this.index += 1;
    }
  }
}

export function parseStrictJson(source, options = {}) {
  assert(typeof source === 'string', 'EVAVO_AGENT_ROUTING_JSON_SOURCE');
  const maximumBytes = options.maximumBytes ?? 1024 * 1024;
  assert(
    Buffer.byteLength(source, 'utf8') <= maximumBytes,
    'EVAVO_AGENT_ROUTING_JSON_BYTES',
  );
  return new StrictJsonParser(
    source,
    options.maximumDepth ?? 64,
    options.maximumNodes ?? 100_000,
  ).parse();
}

export function readStrictJsonFile(filePath, options = {}) {
  const stat = fs.lstatSync(filePath);
  assert(stat.isFile() && !stat.isSymbolicLink(), 'EVAVO_AGENT_ROUTING_FILE_TYPE', filePath);
  const maximumBytes = options.maximumBytes ?? 1024 * 1024;
  assert(stat.size <= maximumBytes, 'EVAVO_AGENT_ROUTING_FILE_BYTES', filePath);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const before = fs.fstatSync(descriptor);
    const source = fs.readFileSync(descriptor, 'utf8');
    const after = fs.fstatSync(descriptor);
    assert(
      before.dev === after.dev &&
        before.ino === after.ino &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs,
      'EVAVO_AGENT_ROUTING_FILE_CHANGED',
      filePath,
    );
    return parseStrictJson(source, { maximumBytes });
  } finally {
    fs.closeSync(descriptor);
  }
}


const FRAGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/u;

function readRoutingFragment(directory, fragmentName, options) {
  const name = text(fragmentName, 'EVAVO_AGENT_ROUTING_FRAGMENT_NAME', {
    maximum: 132,
    pattern: FRAGMENT_PATTERN,
  });
  const candidate = path.resolve(directory, name);
  assert(path.dirname(candidate) === directory, 'EVAVO_AGENT_ROUTING_FRAGMENT_PATH', name);
  return readStrictJsonFile(candidate, options);
}

export function readRoutingConfigFile(filePath, options = {}) {
  const rootDocument = readStrictJsonFile(filePath, options);
  exactKeys(
    rootDocument,
    ['schemaVersion', 'kind', 'canonical', 'clients', 'truthStates', 'policy', 'fragments'],
    [],
    'EVAVO_AGENT_ROUTING_ROOT',
  );
  exactKeys(
    rootDocument.fragments,
    ['authorities', 'transports', 'routes'],
    [],
    'EVAVO_AGENT_ROUTING_FRAGMENTS',
  );
  const directory = path.dirname(path.resolve(filePath));
  const authorities = readRoutingFragment(directory, rootDocument.fragments.authorities, options);
  const transports = readRoutingFragment(directory, rootDocument.fragments.transports, options);
  assert(
    Array.isArray(rootDocument.fragments.routes) &&
      rootDocument.fragments.routes.length >= 1 &&
      rootDocument.fragments.routes.length <= 16,
    'EVAVO_AGENT_ROUTING_ROUTE_FRAGMENTS',
  );
  const routeFragmentNames = uniqueStrings(
    rootDocument.fragments.routes,
    'EVAVO_AGENT_ROUTING_ROUTE_FRAGMENT_NAMES',
    {
      validate: (value, code) =>
        text(value, code, { maximum: 132, pattern: FRAGMENT_PATTERN }),
    },
  );
  const routes = routeFragmentNames.flatMap((fragmentName) => {
    const fragment = readRoutingFragment(directory, fragmentName, options);
    assert(Array.isArray(fragment), 'EVAVO_AGENT_ROUTING_ROUTE_FRAGMENT_TYPE', fragmentName);
    return fragment;
  });
  const { fragments: _fragments, ...base } = rootDocument;
  return { ...base, authorities, transports, routes };
}
