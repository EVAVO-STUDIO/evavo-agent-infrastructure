# EVAVO Vercel Control for ChatGPT, Claude and Codex

EVAVO uses two complementary Vercel surfaces. Neither replaces the other.

## 1. Official Vercel connector

The official Vercel ChatGPT/MCP connection remains useful for provider-native context such as projects, deployments, build/runtime logs, protected deployment access, Agent Runs and Vercel documentation.

Its permission mode may be set to full access, but the actual actions available to an agent are still limited to the tools Vercel publishes through that connector. Permission is not the same thing as tool coverage.

## 2. EVAVO Vercel Control

Full governed provider control is owned by `EVAVO-STUDIO/evavo-development-studio` and exposed to agents through `EVAVO-STUDIO/evavo-agent-infrastructure`.

```text
ChatGPT / Claude / Codex
        |
        +-- official Vercel MCP/connector ----------------> provider-native reads/logs/deploy tools
        |
        +-- EVAVO Vercel Control
             |
             +-- local MCP: evavo-vercel-control
             |       |
             |       +-- Development Studio Vercel Control
             |
             +-- remote ChatGPT effectful route
                     |
                     +-- authenticated Cloudflare typed relay
                     +-- outbound-only Windows WebSocket
                     +-- Invoke-EvavoVercelRelayAction.ps1
                     +-- clean exact Development Studio origin/main
                     +-- existing local VERCEL_TOKEN / VERCEL_API_TOKEN
                     +-- Vercel REST / CLI
                     +-- independent provider read-back
```

The Vercel credential never crosses the remote relay. It remains on the EVAVO workstation/provider-control boundary.

## Local MCP tools

`mcp-server/vercel-control-mcp.mjs` exposes:

- `evavo_vercel_control_capabilities` — static/install readiness only; does not claim authentication proof;
- `evavo_vercel_control_probe` — bounded read-only provider authentication probe;
- `evavo_vercel_control` — plan or execute one governed Development Studio request.

The provider probe exists because a token variable/file being present is not evidence that the credential is valid, correctly scoped or accepted by Vercel.

## Development Studio capabilities

The underlying control surface supports:

- project list/get/create/update/delete;
- environment-variable list/upsert/delete using environment references rather than literal secret values;
- custom environments;
- deployment list/get/deploy/redeploy/promote/rollback/cancel/delete;
- aliases;
- project domain list/get/add/update/verify/remove;
- exact external-registrar DNS planning from Vercel's live project/domain configuration;
- Vercel-hosted DNS record list/create/update/delete;
- constrained raw Vercel REST access locally when a future Vercel feature has not yet received a typed adapter.

Local `api.call` writes require an explicit independent read-only verification request.

## Remote ChatGPT safety boundary

The internet-facing relay intentionally exposes a smaller typed subset as the single `vercel.control` action.

It does not admit:

- caller-supplied shell/PowerShell;
- local filesystem paths;
- caller-supplied Vercel REST paths/methods/bodies;
- raw `api.call`;
- literal environment-variable secret values;
- automatic replay of an uncertain provider mutation.

Every remote write requires a human-readable reason. Destructive operations additionally require the explicit destructive grant. The workstation dispatcher independently revalidates the operation and arguments even after the Cloudflare relay has validated them.

## Credentials

Development Studio recognises either:

```text
VERCEL_TOKEN
VERCEL_API_TOKEN
```

It checks the current process first and then bounded EVAVO local credential files, including the established sibling `evavo-github-mcp/.env` location. Credentials are never printed or retained in Vercel control receipts.

## DNS and external registrars

There are two distinct cases:

### Vercel is authoritative DNS

Use the typed `dns.*` operations. Vercel Control preflights and reads back record changes.

### Porkbun or another registrar remains authoritative

Use `domain.dns-plan` after attaching the exact hostname to the intended Vercel project. It reads the project-domain object and `/v6/domains/{domain}/config` and returns the exact current `recommendedIPv4`, `recommendedCNAME`, verification and misconfiguration state.

Never substitute a generic Vercel A/CNAME value when the exact project/domain recommendation is unavailable.

For Porkbun specifically, a root/apex row uses a **blank Host field**. `@` is only conventional DNS shorthand and is not the value to paste into Porkbun's Host field.

## Evidence model

A configured file, registered MCP or accepted dispatch does not prove a provider mutation happened.

For Vercel:

```text
configured -> provider-authenticated -> planned -> dispatched -> provider accepted -> read-back verified
```

The final state requires a correlated controller receipt plus provider read-back. If a remote effect times out after it may have been sent, the result is ambiguous and must be reconciled before retry; automatic replay is prohibited.

## Queen of Hearts production boundary

The existing `naomi-30-queen-of-hearts` Vercel project remains the stable R13 authentication/session origin. The public custom domain `naomis30th.com` must not replace that origin.

The intended public Vercel front door is a separate guest project serving the repository's `deployment/vercel-guest-r15` release. Only after that guest deployment passes the invitation gate, signed-session presentation and online RSVP checks should `naomis30th.com` / `www.naomis30th.com` be attached and an exact Porkbun DNS plan produced.
