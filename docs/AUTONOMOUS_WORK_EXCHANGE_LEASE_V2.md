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
- zero paid fallback.

Any drift leaves the work item `READY`.

## Still disabled

The lease runner never calls Codex. Model dispatch remains in the separate Codex dispatcher and must gain its own physical `documentation-truth` acceptance before that class can move from `LEASED` to a model turn. Commit, push, validation, publication and deployment remain separate downstream authorities.
