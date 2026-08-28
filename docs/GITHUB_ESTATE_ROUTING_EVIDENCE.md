# GitHub estate routing evidence

`evavo-agent-infrastructure` can convert a recent, signed GitHub MCP repository-estate snapshot into the exact `evavo-agent-capability-status-v1` document consumed by the deterministic capability router.

This is an evidence adapter, not another GitHub control plane. `EVAVO-STUDIO/evavo-github-mcp` remains the authority for GitHub inventory and provider governance. Agent Infrastructure independently verifies its output and selects a declared route; it does not collect the inventory, change repository settings, mutate source, publish, deploy, or access credentials.

## Producer workflow

In `EVAVO-STUDIO/evavo-github-mcp`:

```powershell
node control-plane/repository-estate-snapshot-attestation-cli.mjs init-key
node control-plane/repository-estate-snapshot-attestation-cli.mjs trust > C:\EVAVO\trust\estate-snapshot-trust.json

node control-plane/repository-estate-snapshot-attestation-cli.mjs snapshot `
  --classification-policy C:\EVAVO\policy\repository-classification.json `
  --provider-policy C:\EVAVO\policy\repository-provider-state.json `
  --intent mutation `
  --output-root C:\EVAVO\evidence\repository-estate
```

An attested directory contains:

```text
inventory.json
estate-manifest.json
estate-selection.json
provider-observations.json
provider-audit.json
snapshot-index.json
snapshot-attestation.json
```

The final sidecar is signed with the purpose-specific domain:

```text
EVAVO:GITHUB-MCP:ESTATE-SNAPSHOT:V1\n
```

It binds the exact snapshot digest, index digest, source revision, capability-manifest blob, timestamp, intent, and immutable directory name.

## Verify without routing

```powershell
node scripts/route-github-estate-snapshot.mjs verify `
  --snapshot-root C:\EVAVO\evidence\repository-estate `
  --trust-bundle C:\EVAVO\trust\estate-snapshot-trust.json
```

The verifier fails closed on:

- missing or unexpected directory entries;
- non-canonical snapshot or sidecar JSON;
- duplicate or prototype-polluting JSON keys;
- symlinks and non-regular files;
- file races, size changes, byte-count drift, or SHA-256 mismatch;
- invalid component self-digests or cross-document bindings;
- a directory name that does not match the snapshot digest;
- an unknown, malformed, future-dated, or wrongly bound attestation;
- an untrusted Ed25519 key or invalid signature; and
- a corrupt newest directory. It never silently falls back to older evidence.

## Emit router status

```powershell
node scripts/route-github-estate-snapshot.mjs status `
  --snapshot-root C:\EVAVO\evidence\repository-estate `
  --trust-bundle C:\EVAVO\trust\estate-snapshot-trust.json `
  --client chatgpt-pro
```

The status contains:

```text
capability: repository.inspect
strategy: repository-inspect-connected-github
state: completed
sourceRevision: signed GitHub MCP repository HEAD
receiptId: content-addressed snapshot/index/source/signature binding
observedAt: snapshot time
capturedAt: verification time
```

The distinction between `observedAt` and `capturedAt` is deliberate. Re-verifying an old snapshot does not make it fresh.

## Produce a route plan

```powershell
node scripts/route-github-estate-snapshot.mjs plan `
  --snapshot-root C:\EVAVO\evidence\repository-estate `
  --trust-bundle C:\EVAVO\trust\estate-snapshot-trust.json `
  --client chatgpt-pro
```

The existing capability router then applies its configured transport freshness. The connected-GitHub strategy currently requires evidence no older than its declared threshold. A valid but stale signed snapshot remains authentic while becoming route-ineligible.

Use `--snapshot-directory` instead of `--snapshot-root` to require one exact directory. The root mode selects the newest directory name and verifies that newest candidate; corruption never causes fallback to an older snapshot.

## Authority boundary

Verification and route planning carry all-false authority blocks. They cannot:

```text
execute
mutate source
write repositories
publish
change provider settings
read credentials
```

A `ready` route means only that current signed evidence met the declared threshold. Provider mutation and physical workstation work still require their own owner, policy, acceptance state, and correlated terminal receipt.

## Focused validation

```powershell
node --test tests/github-estate-routing-integrity.test.mjs tests/github-estate-routing-policy.test.mjs
node --check scripts/github-estate-routing-evidence.mjs
node --check scripts/route-github-estate-snapshot.mjs
```
