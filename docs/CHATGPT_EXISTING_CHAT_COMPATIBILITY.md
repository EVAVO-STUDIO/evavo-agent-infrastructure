# Existing-chat compatibility

EVAVO distinguishes discoverability from UI attachment.

- A ChatGPT conversation with the stable EVAVO app attached can discover and invoke newly admitted capabilities through `evavo_capabilities` and `evavo_capability_invoke`, even if that conversation cached its original direct-tool list.
- A conversation with the older `evavo-fleet-readonly` identity uses compatibility aliases rather than a second competing app.
- A conversation without any EVAVO app cannot have a native tool namespace injected by repository code after the conversation has already been created.
- When connected GitHub is available, the governed workstation receipt relay remains the effectful fallback for that conversation.

This is why all future EVAVO tool growth must occur behind the stable catalog/router instead of depending on ChatGPT receiving a new top-level function for each capability.
