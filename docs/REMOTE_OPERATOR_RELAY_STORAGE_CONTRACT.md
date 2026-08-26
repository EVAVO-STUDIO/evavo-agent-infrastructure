# EVAVO Remote Operator Relay — Storage Contract v1

This contract is the shared boundary between the hosted remote-MCP/control relay and the EVAVO Windows execution estate.

## Authority boundary

The relay is transport and correlation only. It MUST NOT forward arbitrary shell text, executable paths, filesystem paths, environment variables, credentials, REST Executor command strings, or generic MCP tool payloads to Windows.

Physical execution stays on the workstation behind the accepted EVAVO Local Storage / Local Compute authority. The workstation expands a small typed operation ID into a reviewed checked-in script. REST Executor v5 may be used behind that local adapter only when the command submitted to it is fixed by checked-in code and is not derived from relay-controlled text.

The public Streamable HTTP `/mcp` surface and the outbound workstation connection are separate surfaces. A successful MCP response is not physical execution proof unless a correlated workstation receipt says so.

## Request

```json
{
  "schemaVersion": 1,
  "kind": "evavo-remote-operator-request-v1",
  "requestId": "ror_...",
  "operation": "storage.status",
  "createdAt": "2026-08-26T00:00:00Z",
  "expiresAt": "2026-08-26T00:05:00Z",
  "nonce": "...",
  "arguments": {}
}
```

Required rules:

- `requestId`: `ror_` followed by 16–96 ASCII letters, digits, `_` or `-`.
- `nonce`: 16–128 ASCII letters, digits, `_` or `-`.
- maximum request lifetime: 10 minutes.
- future clock skew: at most 2 minutes.
- `arguments` MUST be an empty object for every v1 operation.
- unknown fields fail closed.
- request IDs and nonces are replay-protected by the workstation ledger.

## Allowed operations

| Operation | Class | Local intent |
| --- | --- | --- |
| `storage.status` | read | Return bounded zero-cost worker, Google pressure and storage-estate status. |
| `storage.inventory.refresh` | read/observe | Run the V4 estate inventory without Downloads reclaim. |
| `storage.google_pressure.activate` | governed mutation | Run the fixed Google 85/90/75 activation facade. |
| `storage.estate.activate` | governed mutation | Install/refresh the V4 estate governor and permit its policy-governed Downloads reclaim. |

No v1 operation accepts a path, command, repository, executable, script name, provider credential, threshold override, destination override, or delete flag.

## Receipt

```json
{
  "schemaVersion": 1,
  "kind": "evavo-remote-operator-receipt-v1",
  "requestId": "ror_...",
  "operation": "storage.status",
  "ok": true,
  "status": "completed",
  "observedAt": "2026-08-26T00:00:01Z",
  "physicalExecutionAttempted": false,
  "physicalExecutionProven": false,
  "providerActionsObserved": false,
  "pathsReturned": false,
  "credentialValuesReturned": false,
  "result": {}
}
```

`result` is operation-specific and bounded. It MUST NOT contain credential values or absolute physical paths. Local paths may be represented only by approved logical labels or SHA-256 identity hashes.

For Google pressure, `targetReached=true` may be reported only when complete whole-account quota evidence proves usage at or below 75%. A Drive-only lower-bound inventory may trigger reclaim but may never certify target completion.

For Downloads movement, success requires destination copy verification before source removal plus post-removal destination reread and source-absence verification. BeeStation internal archive placement must preserve the 500 GB reserve and remain below the 3.5 TB operational-full boundary; distinct external volumes preserve their configured reserve.

## Replay and physical truth

The workstation stores a create-once replay record keyed by the request identity. A duplicate terminal request is never executed again.

Queued, accepted, relayed, or scheduled does not mean physically executed. Physical success requires a correlated workstation receipt from the local execution authority. Google quota movement additionally requires provider evidence.