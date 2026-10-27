---
name: Proxy page isolation
description: Security implications of loading proxied sites under the Infinitesimal app origin.
---

Treat proxied pages as untrusted. The current URL-rewriting design loads them under the app's browser origin, so page scripts can reach local workspace data. Do not describe the proxy as private or isolated, and keep the warning against signing in or entering sensitive information.

**Why:** removing `allow-same-origin` gives proxied pages an opaque origin and blocks localStorage, but it also prevents the current service-worker URL rewriting from serving proxied navigation (the browser receives the app's not-found page). The working configuration therefore retains the shared origin.

**How to apply:** preserve the visible shared-origin warning. Real isolation needs a separate HTTPS origin for the proxy service worker; do not claim privacy until that architecture is implemented and tested without breaking navigation.
