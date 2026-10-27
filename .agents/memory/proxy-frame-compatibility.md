---
name: Proxy frame compatibility
description: Compatibility and privacy decisions for sandboxed proxied pages.
---

Allow common site features such as forms, scripts, downloads, dialogs, pointer lock, orientation lock, presentation, and user-activated storage access. Keep top-level navigation sandboxed so pages cannot replace the browser shell; route `_blank` links into app-owned tabs so their redirect chains stay inside the browser. Use `strict-origin-when-cross-origin` rather than suppressing referrers entirely.

**Why:** strict suppression and missing browser permissions can break referrer-sensitive assets, dialogs, games, and embedded media. A normal referrer policy improves compatibility but can disclose origin-level metadata to destination sites.

**How to apply:** when adjusting iframe permissions, preserve the shared-origin safety warning and do not add top-navigation permission casually. Preserve the app-tab handling for `_blank` links, keep the referrer tradeoff documented, and test frame behavior in both UV and Scramjet.
