# Documentation-truth grant-bound dispatch

This boundary closes the gap between a Local Storage lease receipt and the first documentation-truth model turn.

## Why it exists

A `LEASED` work item alone is not sufficient evidence that the required externally signed runtime grant was verified and consumed. The grant-bound compiler therefore requires the exact Local Storage lease-effect receipt and binds both its raw bytes and canonical receipt digest into the dispatch plan.

The compiler accepts only a receipt proving:

```text
runtimeGrantVerificationPerformed = true
grantConsumed                     = true
grantConsumptionRecorded          = true
grantConsumedUses                 = 1
grantRemainingUses                = 0
```

The receipt must also agree with the leased work item on work ID, repository, source revision, worker, lease-plan digest, route-admission digest, and expiry. Model, validation, repository, Git, publication, deployment, financial, and paid-fallback effects must all still be false.

## Source flow

```text
Local Storage grant-bound lease-effect receipt
  + LEASED work item
  + current route plan
  + current Codex capability receipt
  + isolated candidate receipt
        ↓
base documentation-truth dispatch compiler
        ↓
grant-bound dispatch compiler
        ↓
plan binds exact lease receipt bytes and grant-consumption identities
        ↓
grant-bound runner revalidates the same receipt bytes
        ↓
existing physically accepted documentation-truth runner
```

The grant-bound runner does not implement another model adapter. It delegates to the existing documentation-truth runner only after the exact lease-receipt and plan chain passes. The existing runner still owns candidate cleanliness, current HEAD, physical acceptance, environment sanitization, path and line limits, structured output, and process execution.

## Evidence carried forward

The dispatch plan adds:

- `leaseEffectReceiptBytesSha256`
- `leaseEffectReceiptSha256`
- `runtimeActivationGrantId`
- `runtimeActivationGrantBodySha256`
- `runtimeActivationGrantVerificationSha256`
- `runtimeGrantConsumptionSha256`
- `grantConsumedBeforeDispatch=true`
- `grantConsumptionRecordedBeforeDispatch=true`

The ordinary model-run receipt already binds the exact dispatch-plan bytes, so deterministic validation can later prove that the model turn depended on the consumed-grant evidence without changing the established run-receipt contract.

## Authority boundary

This source path cannot mint or sign a grant, consume another use, renew or extend a lease, restart an uncertain model turn, validate a candidate, commit, push, publish, deploy, perform a financial action, or use paid capacity.

A later stage that begins after the original lease expires must request a new stage-specific continuation authorization. Neither this compiler nor this runner treats the original consumed grant as perpetual authority.
