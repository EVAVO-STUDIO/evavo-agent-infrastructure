# Codex Documentation Truth Worker

## Purpose

The documentation-truth worker closes one narrow portfolio-maintenance gap: it may create or repair a repository's EVAVO capability declaration when immutable portfolio evidence proves that the declaration is missing or invalid.

It is not a general documentation agent. It cannot rewrite product copy, source code, schemas, dependencies, APIs, creative assets, branding, story, art direction, Git history, releases or deployments.

## End-to-end boundaries

The complete source path is:

1. The Brain produces a zero-authority capability coverage candidate.
2. Development Studio independently admits one exact repository, source revision and evidence set.
3. Local Storage atomically enqueues the deterministic READY work item.
4. Agent Infrastructure selects a current zero-paid-fallback route.
5. Agent Infrastructure compiles a short-lived route-bound lease plan.
6. Local Storage acquires that lease under the canonical Work Exchange lock.
7. Development Studio creates an isolated clean candidate worktree at the exact source revision.
8. Agent Infrastructure compiles a documentation-truth dispatch plan.
9. A dedicated physical-acceptance verifier must admit the exact current adapter, route configuration, Codex version and capability bytes.
10. The runner may start one Codex process in the candidate worktree.
11. The runner audits the observed candidate changes against the worker summary.
12. Separate deterministic validation, Development Studio review and publication gates remain mandatory.

Each stage binds exact SHA-256 evidence. No stage inherits authority merely because the previous stage succeeded.

## Mutation envelope

The worker may change at most one of:

- `evavo.capabilities.json`
- `.evavo/capabilities.json`

The maximum is one changed file, 600 changed lines and one automatic attempt.

A successful candidate must remain valid JSON and retain:

```json
{
  "contractVersion": "evavo_repository_capabilities_v1",
  "repository": "EVAVO-STUDIO/<repository>",
  "authority": "<bounded authority>",
  "summary": "<truthful summary>",
  "capabilities": []
}
```

The worker must prefer `NO_ACTION` when the existing declaration is already truthful or the repository does not own a reusable capability.

## Physical acceptance

Source code and passing unit tests do not constitute physical acceptance.

The route remains inactive until a supervised remote-less fixture proves all of the following with immutable evidence:

- a structured SUCCESS turn producing one valid capability manifest;
- a useful NO_ACTION turn producing no changes;
- rejection of a forbidden-path attempt;
- rejection of a stale current-HEAD attempt;
- ChatGPT consumer authentication with API/provider override variables absent;
- deterministic validation of the successful candidate;
- unchanged primary checkout;
- no worker commit, push, publication or deployment;
- complete detached-candidate cleanup.

The temporary acceptance fingerprint includes the exact physical-acceptance policy, dispatch policy, adapter bytes, worker-route configuration and Codex version. A material change invalidates the receipt.

No acceptance receipt is checked into source control.

## Runner truth

A successful runner receipt proves only:

- the exact dispatch plan and capability bytes were accepted;
- the exact supervised physical-acceptance bytes were reverified;
- the route admission and lease remained unexpired;
- the candidate HEAD matched the admitted source revision;
- the candidate was clean before execution;
- one structured turn completed;
- observed paths matched the worker's structured summary;
- any SUCCESS change was one canonical capability manifest within the line bound;
- candidate HEAD did not change and no Git staging occurred;
- API/provider override environment variables were removed.

It does not prove deterministic validation, correctness, approval, commit, push, publication, deployment or installed production outcome.

## Activation state

`config/documentation-truth-activation-state-v1.json` is authoritative for source readiness versus physical readiness.

The intended pre-certification state is:

```text
sourceContractsImplemented=true
workerRoutePhysicallyAdmitted=false
supervisedPhysicalAcceptanceRecorded=false
capacityStatusAdmitsWorkerClass=false
normalModelExecutionRegistered=false
automaticSchedulingEnabled=false
```

A future activation change must update the route, capacity-status admission and activation record together and must bind the exact supervised acceptance. Merely toggling one Boolean is not authority.
