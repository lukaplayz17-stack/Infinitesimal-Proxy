const CONFIG_URL = "/config.json";
const UV_PREFIX = "/uv/service/";
const SCRAMJET_PREFIX = "/scram/service/";

let config;
let engine;
let bootPromise;
let bareMuxConnection;
let scramjetController;
const pendingFrameNavigations = new WeakMap();

async function loadConfig() {
  const response = await fetch(CONFIG_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Browser configuration could not be loaded (${response.status}).`);
  const value = await response.json();
  if (!["uv", "scramjet"].includes(value.proxyEngine)) {
    throw new Error("The server returned an unsupported proxy engine.");
  }
  return value;
}

function selectedEngine(serverConfig) {
  const local = localStorage.getItem("infinitesimal.workspace.v1.proxyEngine");
  return ["uv", "scramjet"].includes(local) ? local : serverConfig.proxyEngine;
}

function isSecureContextSupported() {
  if (typeof window.isSecureContext === "boolean") return window.isSecureContext;
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(location.hostname);
}

async function registerWorker(currentEngine) {
  if (!isSecureContextSupported()) {
    throw new Error("Service workers require a secure HTTPS page. Open the app at its HTTPS address.");
  }
  if (!("serviceWorker" in navigator)) {
    throw new Error("This browsing context does not expose the Service Worker API. Open the app in a full browser tab on HTTPS and try again.");
  }
  const registration =
    currentEngine === "uv"
      ? await navigator.serviceWorker.register("/uv/sw.js", { scope: "/uv/", updateViaCache: "none" })
      : await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  if (registration.active) return registration;
  const installing = registration.installing || registration.waiting;
  if (!installing) throw new Error("The proxy service worker did not start.");
  if (installing.state === "activated") return registration;
  await new Promise((resolve, reject) => {
    installing.addEventListener("statechange", () => {
      if (installing.state === "activated") resolve();
      if (installing.state === "redundant") reject(new Error("The proxy service worker could not activate."));
    });
  });
  return registration;
}

function getBareMux() {
  const namespace = window.BareMux;
  if (!namespace?.BareMuxConnection) {
    throw new Error("The BareMux browser client did not load from this server.");
  }
  return namespace.BareMuxConnection;
}

async function connectTransport(currentEngine, currentConfig) {
  if (!currentConfig.wispUrl) throw new Error("No Wisp WebSocket URL is configured.");
  const BareMuxConnection = getBareMux();
  bareMuxConnection ||= new BareMuxConnection("/baremux/worker.js");
  const desiredTransport = currentEngine === "uv" ? "/epoxy/index.mjs" : "/libcurl/index.mjs";
  const currentTransport = await bareMuxConnection.getTransport();
  if (currentTransport !== desiredTransport) {
    const options =
      currentEngine === "uv"
        ? [{ wisp: currentConfig.wispUrl }]
        : [{ websocket: currentConfig.wispUrl }];
    await bareMuxConnection.setTransport(desiredTransport, options);
  }
}

async function boot() {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    config = await loadConfig();
    engine = selectedEngine(config);
    await registerWorker(engine);

    if (engine === "uv") {
      if (!window.__uv$config?.encodeUrl || !window.Ultraviolet?.codec?.xor) {
        throw new Error("Ultraviolet browser files did not load.");
      }
      await connectTransport(engine, config);
      return;
    }

    if (typeof window.$scramjetLoadController !== "function") {
      throw new Error("Scramjet browser files did not load.");
    }
    const { ScramjetController } = window.$scramjetLoadController();
    scramjetController = new ScramjetController({
      prefix: SCRAMJET_PREFIX,
      files: {
        wasm: "/scram/scramjet.wasm.wasm",
        all: "/scram/scramjet.all.js",
        sync: "/scram/scramjet.sync.js",
      },
    });
    await scramjetController.init();
    await connectTransport(engine, config);
  })().catch((error) => {
    bootPromise = null;
    throw error;
  });
  return bootPromise;
}

function encode(url) {
  if (!engine) throw new Error("Proxy adapter has not booted.");
  if (engine === "uv") {
    return `${window.__uv$config.prefix}${window.__uv$config.encodeUrl(url)}`;
  }
  if (!scramjetController) throw new Error("Scramjet has not initialized.");
  return scramjetController.encodeUrl(url);
}

function decode(value) {
  if (!engine) throw new Error("Proxy adapter has not booted.");
  const input = String(value || "");
  if (/^https?:\/\//i.test(input)) return input;
  if (engine === "uv") {
    const pathname = new URL(input, location.origin).pathname;
    const encoded = pathname.startsWith(UV_PREFIX) ? pathname.slice(UV_PREFIX.length) : pathname;
    return window.__uv$config.decodeUrl(decodeURIComponent(encoded));
  }
  if (!scramjetController) throw new Error("Scramjet has not initialized.");
  return scramjetController.decodeUrl(new URL(input, location.origin));
}

async function createFrame(value) {
  await boot();
  const frame = document.createElement("iframe");
  frame.className = "browser-frame";
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.allow = "clipboard-read; clipboard-write; fullscreen; autoplay; picture-in-picture";
  frame.allowFullscreen = true;
  frame.scrolling = "auto";
  frame.setAttribute(
    "sandbox",
    "allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-pointer-lock allow-orientation-lock allow-presentation allow-storage-access-by-user-activation",
  );
  if (engine === "uv") {
    pendingFrameNavigations.set(frame, {
      engine,
      target: String(value).startsWith(UV_PREFIX) ? String(value) : encode(value),
    });
    return frame;
  }
  const session = scramjetController.createFrame(frame);
  pendingFrameNavigations.set(frame, { engine, session, target: decode(value) });
  return frame;
}

function navigateFrame(frame) {
  const pending = pendingFrameNavigations.get(frame);
  if (!pending) return;
  pendingFrameNavigations.delete(frame);
  if (pending.engine === "uv") frame.src = pending.target;
  else pending.session.go(pending.target);
}

async function testWispConnection() {
  await boot();
  const currentConfig = config || (config = await loadConfig());
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.close();
      resolve(result);
    };
    const socket = new WebSocket(currentConfig.wispUrl);
    const timer = setTimeout(() => finish({ ok: false, detail: "Connection timed out." }), 5_000);
    socket.addEventListener("open", () => finish({ ok: true, detail: "WebSocket handshake succeeded." }), { once: true });
    socket.addEventListener("error", () => finish({ ok: false, detail: "The Wisp WebSocket could not connect." }), { once: true });
    socket.addEventListener("close", (event) => {
      if (!settled) finish({ ok: false, detail: `Wisp connection closed (${event.code}).` });
    });
  });
}

async function testFetch() {
  await boot();
  const target = "https://example.com/";
  const frame = await createFrame(encode(target));
  frame.title = "Proxy connection diagnostic";
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("The proxied example page did not load within 15 seconds.")), 15_000);
    const finish = (error, result) => {
      clearTimeout(timer);
      frame.remove();
      if (error) reject(error);
      else resolve(result);
    };
    frame.addEventListener("load", () => {
      try {
        const document = frame.contentDocument;
        if (!document) {
          finish(new Error("The proxied page is not available inside the browser frame."));
          return;
        }
        if (document.URL === "about:blank") return;
        const title = document.title || "";
        const bodyText = document.body?.innerText || "";
        if (/blocked during your study session/i.test(title) || /blocked during your study session/i.test(bodyText)) {
          finish(new Error("The active School Mode restrictions blocked the diagnostic page."));
          return;
        }
        if (/there was an error loading|scramjet proxy error|uh oh!/i.test(`${title}\n${bodyText}`)) {
          finish(new Error("The proxy returned an error page instead of the requested site."));
          return;
        }
        finish(null, {
          ok: true,
          detail: title
            ? `Loaded “${title}” through the selected proxy.`
            : "The proxied page completed navigation.",
          contentType: "text/html",
          target,
        });
      } catch (error) {
        finish(error);
      }
    });
    frame.addEventListener("error", () => finish(new Error("The proxied example page failed to load.")), { once: true });
    document.body.append(frame);
    navigateFrame(frame);
  });
}

async function diagnostics() {
  await boot();
  let worker;
  if (!isSecureContextSupported()) {
    worker = { ok: false, detail: "This page is not a secure context. Open the app over HTTPS." };
  } else if (!("serviceWorker" in navigator)) {
    worker = { ok: false, detail: "The current browser context does not expose the Service Worker API. Open the app in a full browser tab." };
  } else {
    const registration =
      engine === "uv"
        ? await navigator.serviceWorker.getRegistration("/uv/service/")
        : await navigator.serviceWorker.getRegistration("/");
    worker = {
      ok: Boolean(registration?.active || registration?.waiting || registration?.installing),
      detail: registration ? "Service worker registration found." : "No matching service worker registration.",
    };
  }
  let transport;
  try {
    await boot();
    transport = { ok: Boolean(await bareMuxConnection.getTransport()), detail: await bareMuxConnection.getTransport() };
  } catch (error) {
    transport = { ok: false, detail: error.message };
  }
  let wisp;
  try {
    wisp = await testWispConnection();
  } catch (error) {
    wisp = { ok: false, detail: error.message };
  }
  let proxiedFetch;
  try {
    proxiedFetch = await testFetch();
  } catch (error) {
    proxiedFetch = { ok: false, detail: error.message };
  }
  return {
    secureContext: { ok: isSecureContextSupported(), detail: isSecureContextSupported() ? "Secure context." : "HTTPS is required for service workers; insecure parent frames can also make a page non-secure." },
    worker,
    wisp,
    transport,
    proxiedFetch,
  };
}

window.InfinitesimalProxy = {
  boot,
  encode,
  decode,
  createFrame,
  navigateFrame,
  diagnostics,
  getConfig: () => config,
};
