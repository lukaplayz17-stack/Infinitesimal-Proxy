import { createServer } from "node:http";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const proxyEngine = process.env.PROXY_ENGINE || "uv";
const defaultSearchEngine = "https://duckduckgo.com/?q=";

if (!["uv", "scramjet"].includes(proxyEngine)) {
  throw new Error(`PROXY_ENGINE must be "uv" or "scramjet"; received "${proxyEngine}".`);
}

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

logging.set_level(logging.NONE);
Object.assign(wisp.options, {
  allow_udp_streams: false,
  allow_private_ips: false,
  allow_loopback_ips: false,
  allow_direct_ip: true,
  stream_limit_total: 256,
  // wisp-js 0.4.1 stores connection.streams as an object, but its per-host
  // limiter iterates it as an iterable and crashes on every allowed stream.
  // Keep the total-stream cap and destination/IP filters enabled.
  stream_limit_per_host: -1,
  hostname_blacklist: [/(^|\.)(localhost|local|internal)$/i],
});

const hitCounts = new Map();
function limitRequests(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  let state = hitCounts.get(key);
  if (!state || now - state.windowStartedAt >= 60_000) {
    state = { windowStartedAt: now, count: 0 };
    hitCounts.set(key, state);
  }
  state.count += 1;
  if (state.count > 90) {
    res.status(429).json({ error: "Too many requests. Wait a minute and try again." });
    return;
  }
  next();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(10_000),
    headers: {
      "user-agent": "Infinitesimal/1.0 (study browser)",
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Upstream service returned ${response.status}.`);
  }
  return response.json();
}

function getWispUrl(req) {
  if (process.env.WISP_URL) {
    const configured = new URL(process.env.WISP_URL);
    if (!["ws:", "wss:"].includes(configured.protocol)) {
      throw new Error("WISP_URL must use ws:// or wss://.");
    }
    return configured.toString();
  }
  const protocol = req.protocol === "https" ? "wss" : "ws";
  return `${protocol}://${req.get("host")}/wisp/`;
}

function configFor(req) {
  return {
    proxyEngine,
    wispUrl: getWispUrl(req),
    searchEngine: defaultSearchEngine,
  };
}

app.get(["/healthz", "/api/healthz"], (_req, res) => {
  res.json({ status: "ok" });
});

app.get(["/config.json", "/api/config"], (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(configFor(req));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/suggest", limitRequests, async (req, res) => {
  const query = String(req.query.q || "").trim().slice(0, 240);
  if (!query) {
    res.json({ suggestions: [] });
    return;
  }
  try {
    const url = new URL("https://duckduckgo.com/ac/");
    url.searchParams.set("q", query);
    url.searchParams.set("type", "list");
    const data = await fetchJson(url);
    const suggestions = Array.isArray(data?.[1])
      ? data[1]
          .map((item) => (typeof item?.phrase === "string" ? item.phrase : ""))
          .filter(Boolean)
          .slice(0, 8)
      : [];
    res.json({ suggestions });
  } catch {
    res.status(502).json({ error: "Search suggestions are unavailable right now." });
  }
});

const weatherCodes = new Map([
  [0, "Clear sky"],
  [1, "Mainly clear"],
  [2, "Partly cloudy"],
  [3, "Overcast"],
  [45, "Fog"],
  [48, "Depositing rime fog"],
  [51, "Light drizzle"],
  [53, "Drizzle"],
  [55, "Dense drizzle"],
  [61, "Light rain"],
  [63, "Rain"],
  [65, "Heavy rain"],
  [71, "Light snow"],
  [73, "Snow"],
  [75, "Heavy snow"],
  [80, "Rain showers"],
  [81, "Rain showers"],
  [82, "Heavy rain showers"],
  [95, "Thunderstorm"],
  [96, "Thunderstorm with hail"],
  [99, "Thunderstorm with hail"],
]);

app.get("/api/weather", limitRequests, async (req, res) => {
  try {
    let latitude = Number(req.query.lat);
    let longitude = Number(req.query.lon);
    let city = String(req.query.city || "").trim().slice(0, 100);
    if (city) {
      const geocode = new URL("https://geocoding-api.open-meteo.com/v1/search");
      geocode.searchParams.set("name", city);
      geocode.searchParams.set("count", "1");
      geocode.searchParams.set("language", "en");
      geocode.searchParams.set("format", "json");
      const found = await fetchJson(geocode);
      const location = found?.results?.[0];
      if (!location) {
        res.status(404).json({ error: `No matching location found for "${city}".` });
        return;
      }
      latitude = Number(location.latitude);
      longitude = Number(location.longitude);
      city = [location.name, location.admin1, location.country].filter(Boolean).join(", ");
    }
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      res.status(400).json({ error: "Enter a city or valid latitude and longitude." });
      return;
    }

    const units = String(req.query.unit || "").toLowerCase() === "fahrenheit" ? "fahrenheit" : "celsius";
    const forecast = new URL("https://api.open-meteo.com/v1/forecast");
    forecast.searchParams.set("latitude", String(latitude));
    forecast.searchParams.set("longitude", String(longitude));
    forecast.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m");
    forecast.searchParams.set("temperature_unit", units);
    forecast.searchParams.set("wind_speed_unit", "kmh");
    forecast.searchParams.set("timezone", "auto");
    const data = await fetchJson(forecast);
    if (!data.current || !Number.isFinite(Number(data.current.temperature_2m))) {
      throw new Error("The weather service returned no current conditions.");
    }
    const symbol = units === "fahrenheit" ? "°F" : "°C";
    res.json({
      city: city || `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
      temperature: `${Math.round(data.current.temperature_2m)}${symbol}`,
      condition: weatherCodes.get(Number(data.current.weather_code)) || "Current conditions",
      windSpeed: `${Math.round(data.current.wind_speed_10m)} km/h`,
      observedAt: data.current.time || null,
      source: "Open-Meteo",
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "The weather service is unavailable." });
  }
});

function normalizeFaviconHost(value) {
  const input = String(value || "").trim().slice(0, 255);
  if (!input || /[\s/@?#]/.test(input)) return null;
  const url = new URL(`https://${input}`);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return null;
  }
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const octets = hostname.split(".").map(Number);
    if (octets[0] === 10 || octets[0] === 127 || octets[0] === 0 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)) {
      return null;
    }
  }
  if (ipVersion === 6 && (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:"))) {
    return null;
  }
  return hostname;
}

app.get("/api/favicon", limitRequests, async (req, res) => {
  let host;
  try {
    host = normalizeFaviconHost(req.query.host);
  } catch {
    host = null;
  }
  if (!host) {
    res.status(400).json({ error: "A public website host is required." });
    return;
  }
  try {
    const url = new URL("https://www.google.com/s2/favicons");
    url.searchParams.set("domain_url", `https://${host}`);
    url.searchParams.set("sz", "64");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { "user-agent": "Infinitesimal/1.0" },
    });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
      res.status(404).end();
      return;
    }
    res.set("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
    res.set("Content-Type", response.headers.get("content-type"));
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.status(502).json({ error: "The favicon service is unavailable." });
  }
});

app.post("/api/translate", limitRequests, async (req, res) => {
  const text = String(req.body?.text || "").trim();
  const target = String(req.body?.target || "").trim();
  if (!text || text.length > 5_000 || !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(target)) {
    res.status(400).json({ error: "Provide text (up to 5,000 characters) and a valid target language code." });
    return;
  }
  try {
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", text);
    url.searchParams.set("langpair", `en|${target}`);
    const data = await fetchJson(url);
    const translatedText = data?.responseData?.translatedText;
    if (Number(data?.responseStatus) !== 200 || typeof translatedText !== "string") {
      res.status(502).json({ error: "Translation was unavailable. The service may be rate-limited; try again later." });
      return;
    }
    res.json({ translatedText, target, source: "MyMemory" });
  } catch {
    res.status(502).json({ error: "Translation service is unavailable. Try again later." });
  }
});

function readAiMessages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) return null;
  let total = 0;
  const messages = [];
  for (const entry of value) {
    if (!entry || !["user", "assistant"].includes(entry.role) || typeof entry.content !== "string") return null;
    const content = entry.content.trim();
    total += content.length;
    if (!content || content.length > 8_000 || total > 30_000) return null;
    messages.push({ role: entry.role, content });
  }
  return messages;
}

async function streamAiResponse(req, res) {
  const messages = readAiMessages(req.body?.messages);
  if (!messages) {
    res.status(400).json({ error: "Send between 1 and 30 user or assistant messages, with no more than 30,000 characters total." });
    return;
  }
  const apiKeys = {
    groq: process.env.GROQ_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  };
  const configuredProvider = process.env.AI_PROVIDER?.trim().toLowerCase();
  const supportedProviders = Object.keys(apiKeys);
  if (configuredProvider && !supportedProviders.includes(configuredProvider)) {
    res.status(503).json({
      error: `AI_PROVIDER must be one of: ${supportedProviders.join(", ")}.`,
    });
    return;
  }
  const provider =
    configuredProvider ||
    (apiKeys.groq ? "groq" : apiKeys.anthropic ? "anthropic" : apiKeys.openai ? "openai" : "");
  const apiKey = provider ? apiKeys[provider] : "";
  if (!apiKey) {
    const requiredKey = provider ? `${provider.toUpperCase()}_API_KEY` : "GROQ_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY";
    res.status(503).json({
      error: `AI is not configured. Set ${requiredKey} in the server environment to enable assistant replies.`,
    });
    return;
  }

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  let endpoint;
  let headers;
  let body;
  let model;
  if (provider === "anthropic") {
    endpoint = "https://api.anthropic.com/v1/messages";
    headers = {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    };
    model = process.env.ANTHROPIC_MODEL || process.env.AI_MODEL || "claude-3-5-haiku-latest";
    body = JSON.stringify({
      model,
      max_tokens: 1_024,
      stream: true,
      messages,
    });
  } else {
    endpoint = provider === "groq"
      ? "https://api.groq.com/openai/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";
    headers = {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    };
    model = provider === "groq"
      ? process.env.GROQ_MODEL || process.env.AI_MODEL || "openai/gpt-oss-120b"
      : process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-4o-mini";
    body = JSON.stringify({
      model,
      stream: true,
      messages,
    });
  }

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
  } catch {
    res.status(502).json({ error: "The AI provider could not be reached." });
    return;
  }
  if (!upstream.ok || !upstream.body) {
    const status = upstream.status;
    let providerMessage = "";
    try {
      const errorBody = await upstream.text();
      providerMessage = JSON.parse(errorBody)?.error?.message || "";
    } catch {}
    providerMessage = String(providerMessage).replace(/[\r\n\t]+/g, " ").slice(0, 240);
    res.status(502).json({
      error: `The configured ${provider} provider returned HTTP ${status} for model ${model}${providerMessage ? `: ${providerMessage}` : ". Check the server key, model setting, and provider access."}`,
    });
    return;
  }

  res.status(200);
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const sendDelta = (content) => {
    if (content) res.write(`data: ${JSON.stringify({ delta: { content } })}\n\n`);
  };

  try {
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const event = JSON.parse(data);
          const text =
            provider === "anthropic"
              ? event.type === "content_block_delta" && event.delta?.type === "text_delta"
                ? event.delta.text
                : ""
              : event.choices?.[0]?.delta?.content || "";
          sendDelta(text);
          if (event.type === "error") {
            res.write(`data: ${JSON.stringify({ error: "The AI provider reported a stream error." })}\n\n`);
          }
        } catch {
          // Ignore non-JSON provider events; only provider text deltas are forwarded.
        }
      }
    }
    res.write("data: [DONE]\n\n");
  } catch {
    if (!res.destroyed) {
      res.write(`data: ${JSON.stringify({ error: "The AI response stream ended unexpectedly." })}\n\n`);
    }
  } finally {
    reader.releaseLock();
    if (!res.writableEnded) res.end();
  }
}

app.post("/api/ai", limitRequests, streamAiResponse);

app.use(express.static(publicDir, {
  fallthrough: true,
  etag: true,
  setHeaders(res, filePath) {
    if (/\.(?:html|js|css)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-store");
    }
  },
}));
app.use("/uv/", express.static(uvPath, { fallthrough: true, etag: true }));
app.use("/epoxy/", express.static(epoxyPath, { fallthrough: true, etag: true }));
app.use("/baremux/", express.static(baremuxPath, { fallthrough: true, etag: true }));
app.use("/scram/", express.static(scramjetPath, { fallthrough: true, etag: true }));
app.use("/libcurl/", express.static(libcurlPath, { fallthrough: true, etag: true }));
app.use((_req, res) => {
  res.status(404).sendFile(path.join(publicDir, "404.html"), (error) => {
    if (error && !res.headersSent) res.status(404).type("text/plain").send("Not found.");
  });
});

const server = createServer((req, res) => app(req, res));
server.on("upgrade", (req, socket, head) => {
  let pathname = "";
  try {
    pathname = new URL(req.url || "/", "http://localhost").pathname;
  } catch {
    socket.destroy();
    return;
  }
  if (pathname === "/wisp/") {
    try {
      wisp.routeRequest(req, socket, head);
    } catch {
      socket.destroy();
    }
    return;
  }
  socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
});

const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error(`PORT must be a valid TCP port; received "${process.env.PORT}".`);
}

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Infinitesimal listening on 0.0.0.0:${port} (${proxyEngine})\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
