# Google Drive space management v1

The Google Drive connector is a provider-native storage path. Space management should be evidence-driven and preserve user data by default.

## Audit sequence

1. Enumerate My Drive folders and owned file metadata.
2. Traverse storage/handoff/project roots with bounded folder listings.
3. Rank non-folder files client-side by byte size because Drive `q` does not support size filtering in this connector path.
4. Identify duplicate-looking binaries by exact name + byte size + folder context; do not rely on text search for ZIP/binary inventory.
5. Treat shared client/project content as preserve-by-default.
6. Prefer removing transient handoff/export payloads only after confirming a durable source of truth exists elsewhere (for example BeeStation/EVAVO Storage).
7. Use move/rename to organize first when deletion is not clearly justified.
8. Permanently delete existing user data only from an explicit cleanup decision; capability tests must use disposable objects.

## Current connector observations

- My Drive listing works.
- Shared Drives list is empty for the connected account.
- Folder create, rename and verified parent move work.
- Folder permanent delete works when the folder ID is passed in file-style URL form: `https://drive.google.com/file/d/<ID>/view`.
- Standard `/drive/folders/<ID>` was rejected by the current delete action.
- Text search is not a reliable binary ZIP inventory.
- Direct quota telemetry is not exposed by the current connector, so reclaimed-space reporting should sum known owned candidate sizes before/after cleanup.

## Initial audit result

The visible EVAVO automation handoff duplicates are tiny (about 1.4 KB each), so deleting them would be cosmetic rather than meaningful space recovery. Larger shared client handover content should not be targeted without ownership/value review.
