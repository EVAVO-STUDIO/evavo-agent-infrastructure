# Documentation-Truth Route-Bound Lease v2

`LEASE_REQUIRED` is not a lease.

This Agent Infrastructure boundary converts exact Local Storage readiness and current route evidence into one short-lived request for the canonical Work Exchange store. It performs no queue mutation, lease acquisition, model turn, repository mutation, commit, push, publication, deployment or financial action.

## Required evidence

The compiler reads exact bytes for:

1. A Local Storage `LEASE_READY` result.
2. The exact `ACTIVATE_ELIGIBLE` activation run bound into that readiness result.
3. A current worker route plan.
4. The same trusted read-only current-`main` observation bound into readiness.

The readiness result must still be no more than 60 seconds old. The current-`main` observation and route admission must be no more than 120 seconds old. Future-dated, expired or digest-mismatched evidence is rejected.

## Source and capacity continuity

All inputs must agree on:

- repository;
- exact source revision;
- worker class `documentation-truth`;
- work class `capability-manifest-maintenance`;
- capacity class `included-consumer`;
- route `codex-spark-pro`;
- model `gpt-5.3-codex-spark`;
- concurrency one;
- one automatic attempt;
- zero paid fallback.

The route must preserve its raw capacity state separately. Only `AVAILABLE` and `DEGRADED` can produce `LEASE_REQUIRED`.

An unavailable but correctly typed, source-bound, zero-effect route produces `RETAIN_READY`. A malformed unavailable route, widened authority or source mismatch produces `REJECTED`.

## Lease lifetime

The default requested lease is 180 seconds. The permitted range is 60 to 300 seconds.

The requested lease may not outlive either:

- the supervised activation run; or
- the current route admission.

When the remaining lifetime is insufficient, the result is `RETAIN_READY`. The compiler does not silently weaken evidence requirements or consume model capacity.

The plan itself expires after at most 60 seconds and must be recompiled after expiry.

## Exact plan contents

A positive plan binds:

- Work Exchange item ID;
- repository and exact source revision;
- worker ID;
- expected exact Work Exchange snapshot SHA-256;
- expected generation;
- readiness canonical and exact-byte digests;
- activation canonical and exact-byte digests;
- current-main exact-byte digest;
- route-plan canonical and exact-byte digests;
- capacity status and route-admission identities;
- supervised acceptance, capability, capacity-observation and acceptance-verification digests;
- route-admission and lease expiry times;
- one-writer-per-repository and concurrency-one limits.

The complete plan carries its own canonical SHA-256.

## Decisions

### `LEASE_REQUIRED`

All evidence agrees and the requested lifetime fits inside the activation and route windows. Local Storage may consider the plan under its canonical exclusive lock.

### `RETAIN_READY`

The evidence is safe, but current included capacity or remaining admission lifetime cannot support a lease. The work remains READY, and no lease or model turn occurs.

### `REJECTED`

The evidence conflicts or authority is widened. Examples include:

- tampered readiness, activation or route digest;
- stale readiness or current-main evidence;
- current-main byte mismatch;
- repository or source-revision mismatch;
- route worker class, model, capacity or concurrency drift;
- malformed unavailable route envelope;
- paid fallback or prior execution claims;
- requested lease outside 60 to 300 seconds.

## Authority that remains absent

The policy and registry keep queue mutation, lease, model, repository mutation, commit, push, publication, deployment, financial action and paid fallback authority false.

The plan must never be fed directly to a generic lease command. Local Storage needs a dedicated route-bound transaction that rechecks the exact snapshot, generation, current `main`, readiness and route identities while holding the canonical store lock.

## Commands

Run the source contract and regression suite:

```text
node scripts/check-documentation-truth-route-bound-lease-v2.mjs
```

Compile one plan:

```text
node scripts/compile-documentation-truth-route-bound-lease-v2.mjs \
  --readiness <lease-readiness.json> \
  --activation-run <activation-run.json> \
  --route-plan <worker-route-plan.json> \
  --repository-head <repository-head.json> \
  --worker-id <worker-id> \
  --lease-seconds 180
```

## Next boundary

The next safe step is a pure Local Storage reducer for this exact plan shape. After reducer tests pass, a separate canonical-store adapter can be built with exclusive locking, exact snapshot/generation compare-and-swap, crash recovery, idempotent replay and durable receipts. Physical registration must remain false until a supervised disposable-store campaign proves those effects.
