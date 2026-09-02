# Google Drive provider-native routing v1

Google Drive is handled as a provider-native cloud storage authority in the EVAVO agent fabric.

## Routing

- Google Drive lifecycle work: connected Google Drive provider.
- BeeStation and registered external USB storage: EVAVO Local Storage.
- Workstation filesystem, Git, builds, tests, CLI and local execution: EVAVO Local Compute.
- GUI-only application interaction: EVAVO Computer Agent.
- Model training/fine-tuning and CUDA training environments: EVAVO Model Lab.
- Physical/pre-boot console: EVAVO Local AI Agent Gateway / Comet route.

## Drive operating contract

Agents should inventory before mutation. Existing user files are never deleted solely because a filename looks old or duplicate. Cleanup should rank owned files by size, redundancy, age, source-of-truth location and business value, then act only on an explicit cleanup decision.

The connected provider has physically proven My Drive list, folder create, rename, move between verified parents, list-after-move, and permanent deletion of disposable test folders. Folder deletion currently requires passing the folder ID in Drive's file-style URL form (`https://drive.google.com/file/d/<ID>/view`) because the connector rejects the standard `/drive/folders/<ID>` form.

Text search is not a complete ZIP/binary inventory, so binary cleanup should enumerate folder metadata and rank sizes client-side. Shared client/project material is preserve-by-default.
