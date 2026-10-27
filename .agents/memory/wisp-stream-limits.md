---
name: Wisp stream limits
description: A Wisp 0.4.1 runtime bug in per-host stream limiting.
---

With `@mercuryworkshop/wisp-js` 0.4.1, keep `stream_limit_per_host` disabled (`-1`): its filter iterates `connection.streams`, while the connection stores streams in a plain object. An allowed TCP destination can therefore throw an uncaught `TypeError` and terminate the app server. Keep the global stream cap and destination/IP restrictions enabled.

**Why:** This package mismatch caused the browser service to exit as soon as it attempted a proxied connection.

**How to apply:** If Wisp is upgraded, verify the stream collection and per-host check are compatible before enabling the per-host limiter again; confirm by exercising a real Wisp TCP stream, not only the HTTP health check.
