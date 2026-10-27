# Infinitesimal

Infinitesimal is a local-first study browser. The interface is plain HTML, CSS, and ES modules served directly by Node; there is no frontend build step.

## What it includes

- Tabbed web browsing through Ultraviolet by default, with Scramjet as a selectable alternative. Both use the bundled Wisp WebSocket server. Links marked to open in a new tab stay in app-owned tabs, including their redirect chains.
- Local tasks, courses, notes with Markdown preview, bookmarks, history, shortcuts, and calendar events. Imported `.ics` events support daily, weekly, monthly, and yearly RRULEs with interval, count, until, and supported weekday/month-day filters; unsupported recurrence rules are imported once with a warning.
- Study sessions with a persistent timer, optional PIN, and service-worker filtering for proxied HTTP/HTTPS requests. Existing WebSocket connections and other apps are not restricted.
- Local audio playlists, generated focus noise, translation, calculator, optional AI assistance, weather, and per-site page tools.
- Local AI conversation history, download activity records with per-entry removal and clear-list controls, JSON workspace import/export, and an erase-all control.

There are no ad networks or analytics pixels. Search suggestions use DuckDuckGo; optional weather, translation, and favicon requests use their named providers. Navigated websites are external content and may collect data under their own policies. Translation text is sent to MyMemory when the user submits it. Optional AI prompts are sent to the configured AI provider.

**Proxy safety:** proxied pages are untrusted and share the app's browser origin so the built-in page tools can work. Do not sign in to accounts or enter sensitive information in proxied pages. The proxy is not an isolation boundary. Proxied frames use the browser's `strict-origin-when-cross-origin` referrer policy for sites that require referrer information; remote sites may receive origin-level referrer metadata.

## Local development

Use Node.js 20 or newer.

From the repository root:

```sh
pnpm install
pnpm --filter @workspace/infinitesimal run check
pnpm --filter @workspace/infinitesimal run dev
```

For a standalone copy outside this pnpm workspace:

```sh
cd artifacts/infinitesimal
npm install
npm run check
npm start
```

The server listens on `PORT` (8080 by default). The Replit artifact workflow supplies its configured preview port.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP and Wisp WebSocket listener |
| `PROXY_ENGINE` | `uv` | Server default proxy engine: `uv` or `scramjet` |
| `WISP_URL` | derived from the request | Optional public `ws://` or `wss://` Wisp endpoint |
| `SEARCH_ENGINE` | DuckDuckGo | Default URL prefix used for address-bar searches |
| `AI_PROVIDER` | inferred from configured provider | `groq`, `openai`, or `anthropic`; set this to choose explicitly |
| `AI_MODEL` | provider default | Optional model name used when no provider-specific model is set |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Optional Groq model name |
| `OPENAI_API_KEY` | unset | Optional server-side OpenAI credential |
| `ANTHROPIC_API_KEY` | unset | Optional server-side Anthropic credential |
| `GROQ_API_KEY` | unset | Optional server-side Groq credential |

Keep AI credentials in Replit Secrets; do not expose them to browser code. If `AI_PROVIDER` is unset and multiple keys are configured, the server selects Groq first, then Anthropic, then OpenAI. If no key is configured, the AI page reports that setup is required instead of returning fabricated content.

Service workers require HTTPS outside `localhost`. Reverse proxies must pass WebSocket upgrades through unchanged. Some destination sites block proxy traffic or restrict embedded pages; this is controlled by those sites.

Video support uses the destination page's native HTML5 player and controls. Playback may still be blocked by DRM, codec availability, autoplay rules, account requirements, or site/provider restrictions; Infinitesimal cannot bypass those limits.

## Deployment

### Replit

The artifact production configuration runs `server/index.mjs` and checks `/healthz`. Use a deployment target that supports persistent Node processes and WebSocket connections; do not deploy as a static site.

### Docker

Build from the repository root so pnpm can read the workspace lockfile:

```sh
docker build -f artifacts/infinitesimal/Dockerfile -t infinitesimal .
docker run --rm -p 8080:8080 -e PORT=8080 infinitesimal
```

### Render

The repository-root `render.yaml` defines the Node service, health check, build command, and start command. Connect the repository as a Blueprint and add optional environment variables in the Render dashboard.

### Railway

The repository-root `railway.json` defines the build, start, and health-check commands. Deploy from the repository root and add optional environment variables in Railway's Variables panel.

### Caddy

Run the Node server on a private port (for example, `PORT=8080`) and use `artifacts/infinitesimal/Caddyfile` with a domain managed by Caddy. Caddy automatically handles TLS and WebSocket upgrades:

```sh
PORT=8080 node artifacts/infinitesimal/server/index.mjs
caddy run --config artifacts/infinitesimal/Caddyfile
```

For other reverse proxies, enable HTTPS and WebSocket pass-through to the Node listener.

## Checks

```sh
pnpm --filter @workspace/infinitesimal run check
pnpm --filter @workspace/infinitesimal run test
pnpm --filter @workspace/infinitesimal run test:browser
```

The check validates package resolution and engine assets. The server test starts both proxy-engine settings and checks health, configuration, the Wisp WebSocket handshake, and served files. Calendar recurrence rules have unit coverage. The browser test runs independently against UV and Scramjet: it follows a redirect to Example Domain, checks rendered text and links, and exercises interactive content plus remote CSS, font, and image layout alongside a public non-DRM video sample. It checks native controls, play/pause/seek, scrolling, and narrow/mobile sizing. Both engine runs are reported even if one fails. This does not override real users' autoplay rules. Other sites may still require a supported codec, user gesture, account, or provider permission; DRM playback remains outside this test and cannot be bypassed.

The current service-worker proxy requires proxied pages to share the app origin. As a result, proxied page scripts may access Infinitesimal's local browser storage; the sandbox is not a privacy boundary. The browser displays a warning and you should not enter credentials or sensitive information. Proper isolation requires serving proxied pages from a separate HTTPS origin with its own service worker. This is not anonymity: proxy servers and network providers can still observe connection metadata, and remote sites receive requests through the proxy.
