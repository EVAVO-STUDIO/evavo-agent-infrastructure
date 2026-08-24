import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const runtime = readFileSync(resolve(process.cwd(), "local-agent-mcp.mjs"), "utf8");
const shim = readFileSync(resolve(process.cwd(), "src", "index.ts"), "utf8");
const folded = runtime.toLowerCase();

describe("EVAVO Local Agent MCP execution bridge", () => {
  it("TypeScript build delegates to the exact production runtime", () => {
    expect(shim).toContain('import "../local-agent-mcp.mjs"');
  });

  it("exposes real typed, file and operator tools", () => {
    for (const marker of [
      'name:"evavo_local_agent_capabilities"',
      'name:"evavo_local_agent_action"',
      'name:"evavo_local_file_list"',
      'name:"evavo_local_file_copy"',
      'name:"evavo_local_operator_execute"',
      '"powershell","python","bash","cmd"',
      'http://127.0.0.1:4329',
    ]) expect(runtime).toContain(marker);
  });

  it("keeps normal execution receiver-owned", () => {
    for (const marker of [
      'repository-estate-safe-sync',
      'workstation-acceptance',
      'No caller executable, script, path or argv is accepted.',
      '/v1/action',
      'evavo-local-agent-rest-action-result-v1',
    ]) expect(runtime).toContain(marker);
  });

  it("keeps normal file authority preservation-first", () => {
    expect(runtime).toContain('const WRITE_ROOTS = Object.freeze(["downloads","beestation","temp"]');
    expect(runtime).not.toContain('WRITE_ROOTS = Object.freeze(["gitrepos"');
    expect(runtime).toContain('/v1/files/list');
    expect(runtime).toContain('/v1/files/copy');
    expect(runtime).toContain('doc.createOnly!==true');
    expect(runtime).toContain('doc.destinationHashVerified!==true');
    expect(runtime).toContain('doc.gitReposWriteAllowed!==false');
  });

  it("operator execution is projection-first, separately gated and never retried", () => {
    for (const marker of [
      'operator-token.json',
      'evavo-local-agent-rest-operator-credential-v1',
      'same-user-operator-credential-projection',
      'EVAVO_LOCAL_AGENT_REST_OPERATOR_EXEC',
      'EVAVO_LOCAL_AGENT_REST_OPERATOR_TOKEN',
      '/v1/operator/execute',
      'execution outcome may be unknown and was not retried',
      'doc.operatorAuthority!==true',
      'doc.shellParameterUsed!==false',
    ]) expect(runtime).toContain(marker);
  });

  it("does not implement direct arbitrary shell or provider routing", () => {
    for (const forbidden of [
      'shell: true',
      'child_process',
      'exec(',
      '0.0.0.0',
      'https://',
      'git reset --hard',
      'push --force',
      '/files/delete',
      '/files/move',
    ]) expect(folded).not.toContain(forbidden);
  });

  it("validates the self-hash-bound capability projection", () => {
    for (const marker of [
      'evavo-local-agent-capability-projection-043-v1',
      'manifestTextSha256',
      'sha256Text(manifestText)!==manifestTextSha256',
      'projectionSelfHashVerified:true',
      'credentialValuesReturned:false',
      'physicalPathsReturned:false',
    ]) expect(runtime).toContain(marker);
  });
});
