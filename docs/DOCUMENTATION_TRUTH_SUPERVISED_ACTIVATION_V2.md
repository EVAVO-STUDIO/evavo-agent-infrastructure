# Documentation-Truth Supervised Activation v2

This boundary answers one question only:

> Is the exact documentation-truth worker route eligible to be activated while all required evidence is still current?

It does not activate that route.

## Why this boundary exists

A capability manifest is useful routing information, but it is not execution authority. A READY Work Exchange record is durable work, but it is not a lease. A Codex capability probe proves supported transport and flags, but it is not a model turn. A successful model response is not independent validation, and independent validation is not publication authority.

The activation compiler keeps these evidence classes separate and fails closed when they do not agree.

## Inputs

The compiler requires exact bytes for all of the following:

1. The sealed autonomous lease-wave manifest.
2. The sealed wave validation receipt.
3. A fresh trusted read-only observation of the repository's current `main` SHA.
4. A canonical Work Exchange deployment or enqueue receipt.
5. A fresh eligible Codex capability receipt.
6. A fresh canonical Spark capacity status.
7. A supervised documentation-truth fixture acceptance.
8. An independent candidate-validation receipt.
9. A clean unchanged-primary-checkout attestation.

Each file is read as a regular non-symlink file, bounded in size and hashed from its exact bytes.

## Decisions

### `ACTIVATE_ELIGIBLE`

All required identities, freshness windows, fixture scenarios and authority boundaries agree. This decision is short-lived and permits only a later, separately governed activation step to be considered.

### `RETAIN_READY`

The evidence is safe but incomplete, stale or not currently dispatch eligible. The work remains READY. No model capacity is consumed merely because an activation precondition is missing.

Typical causes include:

- no current included-capacity route;
- documentation-truth not present in the current route admission;
- stale head, capability or capacity evidence;
- incomplete supervised fixture scenarios;
- no positive canonical Work Exchange receipt.

### `REJECTED`

The evidence conflicts or attempts to widen authority. Examples include:

- different repository or source-revision identities;
- a future-dated observation;
- publication, deployment or paid-fallback claims;
- more than one changed file or more than 600 changed lines;
- a dirty or changed primary checkout;
- a route with a different model or billing class.

## Mandatory supervised fixture scenarios

Physical activation cannot be considered until one supervised fixture campaign proves all of these outcomes:

- one capability manifest can be updated successfully;
- an already-correct manifest returns `NO_ACTION`;
- a forbidden path is rejected;
- stale source HEAD is rejected;
- a second changed file is rejected;
- the 600-line bound is enforced;
- a publication attempt is rejected;
- paid fallback is rejected.

Every scenario must carry its own SHA-256-bound receipt.

## Authority that remains absent

An activation decision performs none of the following:

- configuration mutation;
- queue mutation;
- lease acquisition;
- model execution;
- repository mutation;
- commit or push;
- publication or deployment;
- credential access;
- customer communication;
- financial action;
- driver or firmware change;
- force push or history rewrite;
- GitHub Actions dispatch;
- paid API fallback.

## Usage

```text
node scripts/compile-documentation-truth-supervised-activation-v2.mjs \
  --wave-manifest <wave-manifest.json> \
  --wave-validation <validation-receipt.json> \
  --repository-head <repository-head.json> \
  --work-exchange-receipt <work-exchange-receipt.json> \
  --codex-capability <codex-capability.json> \
  --capacity-status <capacity-status.json> \
  --fixture-acceptance <fixture-acceptance.json> \
  --candidate-validation <candidate-validation.json> \
  --primary-attestation <primary-attestation.json>
```

The source contract and regression tests are run with:

```text
node scripts/check-documentation-truth-supervised-activation-v2.mjs
```

## Next physical step

The Windows workstation must run the supervised fixture campaign against a remote-less disposable fixture repository and retain exact receipts outside both the fixture and its candidate worktree. Only that evidence can make the compiler return `ACTIVATE_ELIGIBLE`. The later lease and model boundaries must still recheck current `main`, current route admission and exact evidence digests immediately before their effects.
