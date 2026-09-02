# Autonomous Work Exchange lease v2

This boundary connects a `READY` Work Exchange record to one short-lived `LEASED` transition without conflating a lease with model execution.

## Ownership

- **Agent Infrastructure** compiles the route-bound lease plan after `plan-worker-route.mjs` has produced a fresh `DISPATCH_ELIGIBLE` route.
- **Local Storage** owns the only physical effect. It re-reads the exact state under the canonical Work Exchange lock, checks the snapshot SHA-256 and generation, applies the pure reducer, atomically writes the state, journals the transaction and persists a content-addressed receipt.
- **Development Studio** remains the engineering admission and later review/publication authority.
- A worker lease is not a model turn, validation result, commit, push, publication or deployment.

## Admitted worker classes

The transaction format understands `test-generation` and `documentation-truth`. This does not automatically make both physically dispatchable. Route planning must provide current class-specific physical admission evidence.

`documentation-truth` remains limited to one of:

- `evavo.capabilities.json`
- `.evavo/capabilities.json`

It may change one file, at most 600 lines, once. It cannot change production source, dependencies, schemas, public APIs, creative assets or owner-authored copy. `NO_ACTION` is valid.

## Grant-bound documentation-truth lease

A documentation-truth lease now has a stricter bridge than test-generation. Agent Infrastructure must pass the complete runtime-grant evidence set to Local Storage:

- the exact Agent Infrastructure checkout that owns the verifier;
- the signed grant envelope;
- the trust anchor;
- the exact grant request.

The four inputs are all-or-nothing. Agent Infrastructure rejects partial evidence, rejects grant evidence for test-generation, and requires the Agent Infrastructure verification root to be the same checkout as the lease runner.

Before invoking the physical effect, the runner verifies that Local Storage advertises all of these properties:

- full-component runtime-grant verification policy v3;
- verification under the canonical exclusive Work Exchange lock;
- atomic grant consumption with lease acquisition;
- single-use enforcement and reuse rejection;
- lease expiry bounded by grant expiry;
- crash recovery and idempotent replay.

After the effect, the runner independently checks the canonical receipt digest and accepts documentation-truth only when the receipt proves:

```text
runtimeGrantVerificationPerformed = true
grantConsumed                     = true
grantConsumptionRecorded          = true
grantConsumedUses                 = 1
grantRemainingUses                = 0
```

It also requires a valid grant ID and exact SHA-256 identities for the grant body, verification receipt and consumption record. A successful lease-run receipt exposes those identities without exposing the grant envelope or trust-anchor contents.

## Fail-closed continuity

A lease binds:

- exact work item ID, repository and source revision;
- exact Work Exchange state bytes and generation;
- one worker ID and worker class;
- exact route-plan bytes and canonical digest;
- current route admission and expiry;
- supervised acceptance, capability, capacity and verification evidence digests;
- one-writer-per-repository;
- a lease expiry that cannot outlive route admission;
- for documentation-truth, one fresh externally signed grant whose single use is consumed in the same state replacement;
- zero paid fallback.

Any drift leaves the work item `READY`.

## Still disabled

The lease runner never calls Codex. Grant consumption authorizes only the exact lease transition; it is not reusable model, validation, Git or publication authority. Model dispatch remains in the separate Codex dispatcher and must gain its own current physical `documentation-truth` acceptance before a model turn. Deterministic validation, commit, push, publication and deployment remain separate downstream authorities.
