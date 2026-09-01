# Documentation Truth Runtime Route Planner

## Status

The documentation-truth runtime route planner is implemented as a **read-only, dormant compiler**.

It does not observe provider capacity, perform physical acceptance, consume a runtime grant, mutate Work Exchange state, acquire a lease or start Codex. It can compile a short-lived route plan only from independently sealed evidence supplied to it.

## Inputs

The planner requires:

1. One exact `READY` documentation-truth work item.
2. One Local Storage runtime grant verification receipt produced by client policy v3.
3. One separately sealed documentation-truth capacity admission.
4. An explicit verification time.

## READY work boundary

The work item must remain:

```text
workerClass: documentation-truth
workClass: capability-manifest-maintenance
capacityClass: included-consumer
maximumChangedFiles: 1
maximumChangedLines: <= 600
maximumAutomaticAttempts: 1
paidFallbackAllowed: false
```

It may target only:

```text
evavo.capabilities.json
.evavo/capabilities.json
```

Production source, dependencies, schemas, public APIs, worker commits, pushes and publication remain forbidden.

## Grant verification boundary

The Local Storage receipt must prove:

- client policy version 3;
- exact unsigned-request identity verification;
- full-component symlink and traversal safety;
- unchanged Agent Infrastructure source;
- unchanged Local Storage source;
- zero consumed uses and one remaining use;
- maximum concurrency one;
- no prior queue, lease, model, Git or publication effect.

The receipt’s canonical SHA-256 is independently recomputed before use.

## Capacity admission boundary

The planner does not create capacity admission. Its input must already be a separately sealed:

```text
evavo-documentation-truth-runtime-capacity-admission-v1
```

That admission must bind:

- exact Agent Infrastructure and Local Storage main SHAs;
- exact runtime grant and request identities;
- exact work item, repository and source revision;
- exact accepted candidate campaign evidence;
- exact physical acceptance evidence;
- a dispatchable raw included-capacity state;
- documentation-truth as the only admitted worker class;
- concurrency one;
- no paid fallback;
- no execution, queue, lease, model, repository or publication effect.

No physical producer for this admission is registered yet.

## Output

A successful compile returns:

```text
evavo-documentation-truth-runtime-route-plan-v1
```

The route plan expires at the earliest of:

- the runtime grant expiry;
- the capacity admission expiry;
- 120 seconds after planning.

It preserves:

```text
maximumConcurrency: 1
paidFallbackUsed: false
executionPerformed: false
queueMutationPerformed: false
leaseAcquired: false
modelTurnPerformed: false
repositoryMutationPerformed: false
publicationPerformed: false
```

The route-plan digest covers its complete canonical body.

## Failure behavior

The planner fails closed for:

- stale or expired grant verification;
- stale or expired capacity admission;
- invalid evidence digest;
- source, work-item, grant or request drift;
- wrong worker class or work class;
- non-dispatchable capacity state;
- concurrency above one;
- paid fallback;
- claimed prior effects;
- unsafe file paths in the CLI.

The CLI error decision is `RETAIN_READY_JOB`. It does not broaden scope merely to use model capacity.

## Activation boundary

These remain false:

```text
runtimeCapacityAdmissionProducerRegistered
normalRouteRegistered
normalLeaseRegistered
normalModelExecutionRegistered
```

A real capacity-admission producer requires the Windows physical fixture campaign, current ChatGPT-consumer Codex capability evidence, current included-plan capacity evidence, the accepted candidate campaign, exact source reconciliation and a signed runtime grant. Until then, this planner is source-only and dormant.
