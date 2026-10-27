---
name: Proxy browser tests
description: Reliable Chromium test setup for proxied pages and media in Infinitesimal.
---

Drive navigation through Infinitesimal's own address bar, then inspect the proxied iframe through its same-origin `contentDocument`. Avoid CDP top-level navigation for proxied URLs; service-worker navigations can leave `Page.navigate` pending, while cross-process iframe CDP contexts are unreliable. When setting a media source inside a proxied document, use the raw upstream URL so the proxy engine rewrites it once; pre-encoding it causes nested proxy URLs.

**Why:** Chromium's process isolation and the app's service-worker routing made direct CDP navigation/iframe-context inspection unreliable, even though normal in-app navigation and media playback worked.

**How to apply:** Browser tests should use the visible omnibox flow, wait for the proxied iframe document, and inspect media, scrolling, and playback through that same-origin document. Run the test separately with both UV and Scramjet.

When testing an engine change that reloads the app, seed the test engine in localStorage only when no selection exists. Re-forcing the initial engine on every document load silently undoes the page-level switch and makes a correct retry look broken.

**Why:** The alternate-engine action reloads the app while preserving the selected engine in localStorage; Chromium's add-script-on-new-document hook runs again during that reload.

**How to apply:** Browser-test setup scripts should provide a default engine without overwriting an engine selected during the test.
