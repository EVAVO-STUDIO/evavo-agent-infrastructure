# Codex Documentation Truth Dormant Fixture Campaign

## Purpose

The campaign produces post-publication physical evidence for the dormant documentation-truth worker without enabling its normal route or touching a product repository.

It runs only in a newly created, remote-less temporary Git repository and writes receipts only into a new external evidence directory.

## Inputs

The campaign requires:

- the exact cross-repository activation design;
- the dormant publication attestation for the exact Agent Infrastructure and Local Storage remote `main` SHAs;
- a fresh eligible Codex capability receipt;
- the current Agent Infrastructure worker adapter and campaign policy.

Every resulting scenario receipt binds:

```text
cross-repository design SHA-256
Agent Infrastructure published main SHA
Local Storage published main SHA
fixture ID
Codex version
worker class: documentation-truth
work class: capability-manifest-maintenance
route: codex-spark-pro
model: gpt-5.3-codex-spark
capacity: included-consumer
```

## Physical enable gate

A direct physical campaign requires:

```powershell
$env:EVAVO_DOCUMENTATION_TRUTH_FIXTURE_CAMPAIGN_ENABLED = "1"
```

The variable is removed from the Codex child environment. The runner also strips API-key and provider-override variables, including `OPENAI_API_KEY`, `CODEX_API_KEY` and `OPENAI_BASE_URL`.

The campaign cannot silently fall back to paid API credentials.

## Scenarios

### Validated success

A fresh detached candidate begins at the fixture base commit. Codex must create exactly:

```text
evavo.capabilities.json
```

The external validator checks the strict repository-capability contract and ensures:

- one capability only;
- the exact fixture repository identity;
- recognised interfaces and effects;
- no unsupported fields;
- at most 600 changed lines;
- the structured worker summary equals the physical changed path.

### Validated NO_ACTION

A second detached candidate starts from a fixture commit that already contains the complete manifest. Codex must return `NO_ACTION` and leave the worktree unchanged.

`NO_ACTION` is a successful terminal result and consumes no artificial source work.

### Forbidden path rejection

The runner creates a fixture-only `README.md` mutation and proves the bounded validator rejects it as `FORBIDDEN_PATH`. No model turn occurs and the candidate is discarded.

### Stale head rejection

The runner creates a detached candidate, records the expected source commit, moves the candidate to another fixture commit and proves `STALE_HEAD` before a model process is created.

## Cleanup proof

After all scenarios the campaign must prove:

```text
fixture repository remotes: 0
fixture primary checkout clean: true
fixture main unchanged: true
candidate cleanup complete: true
registered worktrees after cleanup: 1
normal route unchanged: true
worker commit: false
```

The entire temporary fixture repository is then removed. Evidence remains in the external evidence directory.

## Command

```powershell
$env:EVAVO_DOCUMENTATION_TRUTH_FIXTURE_CAMPAIGN_ENABLED = "1"

node scripts/run-codex-documentation-truth-dormant-fixture-campaign.mjs `
  --design C:\Evidence\cross-repository-design.json `
  --publication C:\Evidence\dormant-publication-attestation.json `
  --capability C:\Evidence\fresh-codex-capability.json `
  --evidence-base C:\EVAVO-Evidence\documentation-truth
```

The command returns the external evidence directory and the campaign, supervision and scenario receipt digests.

## Test mode

The contract tests inject a fake Codex executor. They exercise the complete Git fixture, validation, rejection and cleanup logic without a provider call.

They cover:

- valid success;
- valid `NO_ACTION`;
- stale capability evidence;
- dormant-policy drift;
- evidence-directory path escape;
- forbidden success path;
- hidden `NO_ACTION` mutation;
- malformed structured worker output;
- missing physical-enable environment.

## Authority boundary

The runner may mutate only:

1. its newly created remote-less fixture repository;
2. its newly created external evidence directory.

It has no authority to change product repositories, normal route configuration, Work Exchange state, commits on product history, pushes, publication, deployment, financial state or paid fallback.
