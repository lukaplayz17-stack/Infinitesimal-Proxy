---
name: Replit preview wrapper
description: Replit editor previews can expose an internal iframe URL instead of the artifact route.
---

Inside an editor preview, `location.href` may be Replit's `/__replco/workspace_iframe.html?initialPath=...` wrapper URL, not the app's standalone route. For an “open in new tab” link, use the current origin plus the decoded `initialPath` instead of reopening the wrapper.

**Why:** The workspace wrapper is an internal embedded-preview page; opening it as if it were the app can show a misleading browser navigation error.

**How to apply:** When building standalone links from an embedded Replit preview, detect the wrapper route and resolve its `initialPath` on the same origin. Keep normal route URLs unchanged.
