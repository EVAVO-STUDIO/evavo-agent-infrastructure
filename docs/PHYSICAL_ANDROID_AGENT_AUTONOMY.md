# EVAVO Physical Android Agent Autonomy

This document defines the production authority model for EVAVO agents working with Android phones and tablets connected to the managed Windows workstation.

## Goal

After an owned Android device has completed Android's one-time workstation trust/bootstrap requirements, an EVAVO agent should be able to perform normal development and QA without using the human as a command relay.

The normal path is:

```text
Claude Code / Codex / local MCP agent
              |
              v
narrow EVAVO specialist MCP
              |
              v
Local Agent REST gateway 0.45 (127.0.0.1:4329)
              |
              v
EVAVO Android Device Bridge
              |
              v
USB or admitted local-Wi-Fi ADB
              |
              v
owned physical Android device
```

For Godot gameplay:

```text
agent -> evavo-godot-android-physical MCP
      -> Godot Game Test Lab
      -> Android Device Bridge guarded port mapping
      -> debug-only loopback semantic driver
      -> allow-listed InputMap actions + project-owned state assertions
```

For hosted ChatGPT observation on supported account/product surfaces:

```text
ChatGPT -> OpenAI Secure MCP Tunnel
        -> outbound-only workstation tunnel client
        -> evavo-android-observer MCP
        -> fixed read-only Android Bridge probes
```

The hosted observer is deliberately read-only. It is not the effectful Android execution path.

## What becomes zero-click after workstation trust

Once Android USB debugging is enabled and this workstation's ADB RSA key is already trusted, narrow EVAVO specialist tools may autonomously:

- detect the connected physical device and select it by privacy-safe `targetRef`;
- profile model, Android/API level, ABI, battery, BLE capability and observed OpenGL ES requirement;
- build reviewed Android application source;
- verify APK package identity and SHA-256;
- install or update development APKs;
- launch and stop development applications;
- capture screenshots and bounded logcat evidence;
- inspect crash, ANR, native-crash and package-running health;
- inspect bounded package memory/display/orientation health;
- exercise package-bound Android UI nodes;
- exercise foreground games using normalized bounded game-input when appropriate;
- deploy and semantically play Godot debug Android builds;
- assert project-owned gameplay checkpoints/state;
- clear private data for a verified non-system development package;
- uninstall a verified non-system development package;
- create and remove exact bounded ADB forward/reverse mappings required by a reviewed workflow;
- reconnect through admitted Wi-Fi ADB after its platform-specific bootstrap has been completed.

These actions use fixed specialist contracts. They do not require the user to paste PowerShell/ADB commands into chat.

## Android consent that cannot be bypassed

EVAVO tooling must not attempt to bypass Android's security boundary. Human/device-side consent remains required where Android itself requires it, including:

- enabling Developer options / USB debugging on a device where it is disabled;
- first-time approval of this workstation's ADB RSA key, or approval again after trust keys are revoked/reset;
- Android Companion Device / Bluetooth association chooser confirmation where required by the OS;
- runtime permission dialogs that Android requires the application/user to approve and that have not already been granted;
- device unlock where Android refuses debugging or protected actions while locked.

After those grants exist, ordinary repeat development should not invent additional human confirmations.

## Bluetooth

Bluetooth is **not** an ADB transport in this architecture.

Bluetooth/BLE is used by applications such as EVAVO Glasses to communicate with approved companion hardware. Android development, APK install, logcat and debugging use USB ADB or admitted local-Wi-Fi ADB.

The Glasses app uses Android Companion Device association and then bounded BLE GATT logic. On older Android versions, an approved legacy chooser `BluetoothDevice` is retained in memory only; raw Bluetooth addresses are not persisted or reconstructed.

## Device destruction boundary

"Fully control our development device" does not mean giving agents unrestricted destructive Android system authority.

EVAVO Android Device Bridge permits reset/uninstall only after Android proves the target package is installed and non-system. It does not expose an unrestricted `adb shell`, arbitrary package deletion, arbitrary settings automation, arbitrary text/keycode injection, bootloader flashing or system-partition mutation.

If a future workflow genuinely requires a new high-impact device operation, add a typed operation with its own admission, evidence and rollback/recovery contract rather than expanding the general shell surface.

## Agent client policy

### Claude Code

The workstation installer registers these specialist MCP servers at user scope and adds MCP permission allow rules so ordinary specialist calls do not repeatedly prompt:

- `evavo-android-device`
- `evavo-android-app`
- `evavo-glasses-android`
- `evavo-glasses-tab-a`
- `evavo-godot-android-physical`

The broad `evavo-local-agent-executor` is deliberately not part of automatic approval.

### Codex

The same specialist MCP servers are registered in the shared Codex CLI/IDE MCP configuration. Each specialist is configured for automatic MCP-tool approval; long-running Glasses/physical-Godot tools receive a one-hour tool timeout.

The broad operator MCP remains outside the auto-approved specialist set.

### Other local MCP agents

`%LOCALAPPDATA%\EVAVO\AgentClients\physical-android.mcp.json` is the client-neutral generated stdio bundle. `config/physical-android-agent-surfaces.json` is the source-controlled policy manifest describing which surfaces are safe to auto-approve and which must remain restricted.

### Hosted ChatGPT

The EVAVO Android observer is a separate read-only MCP. When a supported ChatGPT custom-MCP configuration and OpenAI Secure MCP Tunnel are available, `Install-EvavoChatGPTAndroidObserverTunnel.ps1` projects only that observer over an outbound tunnel.

Do not expose the broad operator, app mutation, APK install/uninstall, game-input, Glasses device acceptance or physical Godot execution through the read-only observer tunnel.

## Persistence and self-healing

`ENABLE-EVAVO-PHYSICAL-ANDROID-AGENT.ps1` is the canonical one-shot workstation estate entrypoint. It:

1. activates Local Agent REST gateway 0.45 with the reviewed bounded long-operation lane;
2. provisions/reuses Android host tooling;
3. registers narrow MCP specialists in available local agent clients;
4. installs a limited-user gateway guardian;
5. runs the live USB/ADB/MCP diagnostic;
6. optionally establishes the hosted ChatGPT read-only observer tunnel when its prerequisites already exist.

`EVAVO Physical Device Gateway Guardian 0.45` runs at logon and periodically. It restores gateway 0.45 if an older compatibility bootstrap or runtime failure has replaced/degraded the gateway.

The guardian is local, limited-user, loopback-only and external-network-free.

## Truth ladder

Never collapse these states into one generic "connected":

1. **USB visible to Windows** — Windows sees Samsung/Android/MTP hardware.
2. **ADB interface visible** — the Windows ADB driver/interface exists.
3. **ADB authorised** — the device has trusted the workstation and exposes a private `targetRef`.
4. **Physical-device proven** — bridge classification is `physical`, not emulator/unknown.
5. **Development-compatible** — API/ABI/capability constraints for the target workflow pass.
6. **APK built and verified** — source/build/AAPT2/SHA evidence exists.
7. **APK installed** — Android Bridge has a verified installation receipt.
8. **Application healthy** — process remains running and fresh crash/ANR/native-crash diagnostics pass.
9. **Runtime viable** — package-scoped memory/display/orientation health has been observed.
10. **Gameplay exercised** — bounded game input or Godot semantic journey actually executed.
11. **Gameplay outcome proved** — semantic state/checkpoint assertions passed.

A lower step never proves a higher one.

## Current Galaxy Tab A acceptance

The EVAVO Glasses durable Tab A acceptance requires:

- exactly one authorised physical Android device when auto-selecting;
- API 26 or newer;
- Bluetooth Low Energy capability;
- bridge Glasses compatibility admission;
- clean/exact reviewed source when required;
- native Android Gradle/unit build success;
- AAPT2 package/version/minSdk/targetSdk verification;
- exact APK SHA binding;
- install/update and launch on the physical device;
- fresh crash/ANR/native-crash diagnostic gate;
- package health observation after launch.

Memory is currently retained as observed evidence rather than an invented pass/fail threshold. Calibrate an explicit budget only after collecting real evidence from the target Galaxy Tab A and representative production hardware.
