---
name: Scramjet V1 startup
description: Scramjet 1.1.0 service-worker database initialization and URL routing constraints.
---

Scramjet 1.1.0's service-worker constructor opens `$scramjet` IndexedDB at version 1 without creating stores. If it opens first, the controller cannot create the required stores because the database is already version 1. Create/repair the schema before constructing the service-worker client. Keep the proxy URL prefix distinct from the `/scram/` vendor-asset directory; otherwise the worker can treat its own scripts as proxied pages.

Its controller's `loadConfig` message handler assigns `worker.config` but does not initialize the bundle's module-level URL-rewriter config. The next proxied fetch can then fail with an undefined `prefix`. When a config message arrives, force one reload through `worker.loadConfig()` before proxying. The user chose to remain on stable Scramjet 1.1.0 rather than move to the available V2 alpha.

**Why:** Database and config initialization failures can make Scramjet fail even when its bundle and transport files load successfully; the user explicitly preferred the stable release over a prerelease migration.

**How to apply:** When changing Scramjet versions or routing, validate first load and reload in a browser with an empty profile, inspect the database stores, and run a real proxied navigation. Preserve existing rows if repairing a partial schema, and do not migrate to V2 alpha without asking.
