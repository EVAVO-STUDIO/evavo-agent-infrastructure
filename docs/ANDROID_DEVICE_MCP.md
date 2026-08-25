# Android Device MCP

`evavo-android-device` is the fixed Android workstation specialist for EVAVO agents. It composes the existing local operator service with `EVAVO-STUDIO/evavo-android-device-bridge`; it does not create a second ADB implementation and it does not expose caller-supplied command text.

## Authority chain

```text
ChatGPT / Claude / local agent
        |
        v
 evavo-android-device MCP
        |
        v
Local Agent operator service (127.0.0.1:4329)
        |
        v
 evavo-android-device-bridge
        |
        v
 owned Android phone/tablet
```

The general `evavo-github-mcp` Local Agent receiver remains read-only. General structured physical execution remains owned by `evavo-local-execution`. The Android specialist exists because Android bring-up benefits from fixed typed operations that never require an agent to author raw PowerShell or ADB arguments.

## Tools

- `evavo_android_setup_host`: provision/reuse official Platform Tools and AAPT2. Host mutation only; no Android-device mutation. Physical tooling paths are redacted by the MCP adapter.
- `evavo_android_usb_diagnostics`: inspect privacy-safe Windows PnP facts for Samsung/Android/ADB/MTP interfaces. No instance IDs or USB serials are returned.
- `evavo_android_bringup`: combine host readiness, ADB inventory and development classification. Read-only against the device.
- `evavo_android_doctor`: bridge host/device readiness doctor.
- `evavo_android_devices`: privacy-safe ADB device inventory.
- `evavo_android_profile`: profile one authorised private `targetRef` for OS/ABI/transport/Godot compatibility.

## Truth ladder

The tools intentionally distinguish these states:

1. **USB physically visible to Windows** — Windows PnP sees an Android/Samsung/MTP interface.
2. **ADB interface available** — Windows has an Android/ADB interface, but the device may still need RSA approval.
3. **ADB authorised** — the bridge returns an authorised private `targetRef`.
4. **Development-profiled** — API level, ABI and transport policy are known from the live device.
5. **APK installed/launched** — requires a separately governed app/Godot execution flow.
6. **Gameplay exercised** — requires bounded Android game input or the Godot Game Test Lab semantic journey lane.

A lower step never proves a higher one.

## Samsung Galaxy Tab A bring-up

The Galaxy Tab A product family spans multiple generations, so agents must not infer API level, ABI, renderer support or wireless-debugging mode from the retail family name. Use live evidence:

```text
evavo_android_usb_diagnostics
        -> evavo_android_bringup
        -> evavo_android_profile(targetRef)
```

If Windows sees Samsung/MTP but no ADB interface, enable Developer options and USB debugging on the tablet and review the Samsung Android USB driver if the interface remains absent. If ADB reports `unauthorized`, unlock the tablet and approve the workstation's USB debugging RSA prompt.

For Android 11/API 30 or newer, use secure Wireless Debugging after USB bring-up when desired. For Android 8–10/API 26–29, the bridge may explicitly bootstrap legacy unencrypted `adb tcpip` from an already-authorised USB connection on a trusted private network. Bluetooth is not treated as an ADB transport.

## Physical acceptance

Handshake only, no tablet contact:

```powershell
.\scripts\Test-EvavoAndroidDeviceMcp.ps1
```

Real read-only workstation/tablet round trip:

```powershell
.\scripts\Test-EvavoAndroidPhysicalBringup.ps1
```

Provision host tooling first when needed:

```powershell
.\scripts\Test-EvavoAndroidPhysicalBringup.ps1 -SetupHost
```

The physical acceptance proves only the bring-up facts returned in its receipt. It does not install an APK or claim gameplay.

## Registration

The specialist is registered in the `.mcp.json` files for:

- `evavo-agent-infrastructure`
- `evavo-local-storage`
- `evavo-development-studio`
- `evavo-android-device-bridge`

MCP clients normally load server registrations when they initialize their repository/session. Updating a repository registration does not imply that an already-running client hot-reloads the newly added tool surface.
