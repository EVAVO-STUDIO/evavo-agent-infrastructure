# ChatGPT fleet read-only app

Canonical contract: `config/chatgpt-fleet-readonly-app-v1.json`

`evavo-fleet-readonly` is the native ChatGPT observation surface for EVAVO workstation and fleet state. It is deliberately separate from Local Compute execution authority.

## What the app may expose

The app may return bounded, secret-free status and diagnostic information such as workstation readiness, admitted capability classes, gateway/fabric status, job status, worker state, repository observation and read-only plans.

The live tool inventory is discovered from MCP `tools/list`; this document does not duplicate a mutable list of tool names. Every advertised tool must be classified as read-only, and any unknown or unclassified tool fails acceptance.

## What the app must never expose

The app must not provide raw shell or PowerShell, caller-selected executables, filesystem writes, Git mutation, source publication, provider/deployment mutation, credential retrieval, arbitrary browser/desktop/HID/KVM control, power/firmware control or arbitrary network requests.

Transport is not authority. A tunnel or connected app cannot grant Local Compute, Development Studio, Gateway or physical-control permissions.

## Effectful fallback

When the current ChatGPT workspace does not have the native app attached, effectful work uses the separately governed ChatGPT GitHub issue relay. That relay validates a fixed task contract, talks to the Local Agent over loopback, delegates to Local Compute and requires a correlated physical receipt.

The read-only app may observe that path but may not create or approve execution requests.

## Visibility and connection truth

Repository source, a deployed endpoint, a tunnel process and an installed custom app are different evidence states. None proves that tools are visible in the current conversation.

Native visibility requires a fresh ChatGPT-side observation of `tools/list` after the custom app is attached and authorised. A connection refresh or a new conversation may be required after attachment or a tool-inventory change. Repository changes cannot hot-inject a top-level tool namespace into an already-running conversation.

## Acceptance

Acceptance requires all of the following in a fresh supported workspace:

- the app is attached and authenticated;
- ChatGPT observes `tools/list` successfully;
- every advertised tool is read-only;
- no forbidden capability class is present;
- responses are bounded and return no credentials or physical paths;
- audit/correlation evidence is available;
- the observed tool inventory matches the reviewed deployment.

Until that observation exists, report the app as source-staged, deployed, connected or workspace-visible only when the corresponding evidence supports that exact state.
