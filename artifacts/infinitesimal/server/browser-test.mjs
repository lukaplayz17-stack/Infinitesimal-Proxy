import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const serverScript = fileURLToPath(new URL("./index.mjs", import.meta.url));
const chromium = process.env.CHROMIUM_BIN || "/repl/tools/bin/chromium";
const proxyEngine = process.env.PROXY_ENGINE || "scramjet";
const proxyPath = proxyEngine === "uv" ? "/uv/service/" : "/scram/service/";
const pageUrl = "https://example.com/";
const mediaUrl = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(url, child, timeout = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (child.exitCode !== null) throw new Error(`A test process exited early (${child.exitCode}).`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return await response.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

class DevTools {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.events = [];
    this.socket.on("message", data => {
      const message = JSON.parse(data.toString());
      if (!message.id) {
        this.events.push(message);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }

  async ready() {
    await new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools timed out while running ${method}.`));
      }, 20_000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close() {
    this.socket.close();
  }
}

function flattenFrames(node, result = []) {
  result.push(node.frame);
  for (const child of node.childFrames || []) flattenFrames(child, result);
  return result;
}

async function evaluateFrame(cdp, frameId, expression, options = {}, sessionId) {
  const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
    frameId,
    worldName: "infinitesimal-browser-test",
  }, sessionId);
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    contextId: executionContextId,
    awaitPromise: options.awaitPromise === true,
    returnByValue: true,
    userGesture: options.userGesture === true,
  }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  const value = result.result?.value;
  return typeof value === "string" ? JSON.parse(value) : value;
}

const appPort = await freePort();
const debugPort = await freePort();
const baseUrl = `http://127.0.0.1:${appPort}`;
const userData = await mkdtemp(join(tmpdir(), "infinitesimal-browser-test-"));
const app = spawn(process.execPath, [serverScript], {
  env: { ...process.env, PORT: String(appPort), PROXY_ENGINE: proxyEngine, NODE_ENV: "test" },
  stdio: "ignore",
});
const browser = spawn(chromium, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  "--remote-allow-origins=*", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userData}`, "about:blank",
], { stdio: "ignore" });

let cdp;
try {
  await waitFor(`${baseUrl}/healthz`, app);
  await waitFor(`http://127.0.0.1:${debugPort}/json/version`, browser);
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" }).then(response => response.json());
  cdp = new DevTools(target.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `if (!localStorage.getItem("infinitesimal.workspace.v1.proxyEngine")) localStorage.setItem("infinitesimal.workspace.v1.proxyEngine", ${JSON.stringify(proxyEngine)})`,
  });
  await cdp.send("Page.navigate", { url: baseUrl });
  const adapterDeadline = Date.now() + 10_000;
  let adapterReady = false;
  while (Date.now() < adapterDeadline) {
    const result = await cdp.send("Runtime.evaluate", {
      expression: "typeof window.InfinitesimalProxy?.boot === 'function'",
      returnByValue: true,
    });
    if (result.result?.value === true) {
      adapterReady = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(adapterReady, true, `${proxyEngine}: proxy adapter should load before browser interaction`);

  const navigationResult = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      await window.InfinitesimalProxy.boot();
      const onboarding = document.querySelector("#onboarding-form");
      if (onboarding) {
        onboarding.querySelector('[name="firstName"]').value = "Browser test";
        onboarding.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
      const blankButton = document.querySelector('[data-action="new-blank-tab"]');
      if (!blankButton) throw new Error("The about:blank button did not render in the top bar.");
      const appTabCount = document.querySelectorAll(".tabbar .tab").length;
      const originalOpen = window.open.bind(window);
      window.__browserTestOpenedWindow = null;
      window.open = (...args) => {
        window.__browserTestOpenedWindow = originalOpen(...args);
        return window.__browserTestOpenedWindow;
      };
      blankButton.click();
      const blankWindow = window.__browserTestOpenedWindow;
      if (!blankWindow) throw new Error("The about:blank button did not open a host-browser tab.");
      const shellDeadline = Date.now() + 10_000;
      let shellReady = false;
      let shellFrame;
      while (Date.now() < shellDeadline) {
        shellFrame = blankWindow.document?.querySelector('iframe[title="Infinitesimal browser"]');
        const shellDocument = shellFrame?.contentDocument;
        if (shellDocument?.querySelector(".chrome") && shellDocument?.querySelector(".brand")) {
          shellReady = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!shellReady) {
        let diagnostic = {};
        try {
          diagnostic = {
            hostUrl: blankWindow.location.href,
            shellCount: blankWindow.document?.querySelectorAll("iframe").length || 0,
            shellSrc: shellFrame?.src || "",
            shellUrl: shellFrame?.contentDocument?.URL || "",
            shellTitle: shellFrame?.contentDocument?.title || "",
            shellReadyState: shellFrame?.contentDocument?.readyState || "",
          };
        } catch (error) { diagnostic.error = error?.message || String(error); }
        throw new Error("The host about:blank tab did not render the full Infinitesimal browser: " + JSON.stringify(diagnostic));
      }
      if (blankWindow.location.href !== "about:blank") throw new Error("The host tab navigated away from about:blank.");
      if (document.querySelectorAll(".tabbar .tab").length !== appTabCount) {
        throw new Error("The about:blank button created an internal Infinitesimal tab instead of a host-browser tab.");
      }
      const hostTabUrl = blankWindow.location.href;
      blankWindow.close();
      const input = document.querySelector("#omnibox");
      const form = document.querySelector("#omnibox-form");
      if (!input || !form) throw new Error("The browser address bar did not render in the blank tab.");
      document.querySelector('[data-view="downloads"]')?.click();
      const address = document.querySelector("#omnibox");
      address.focus();
      address.value = "draft.example";
      navigator.serviceWorker.dispatchEvent(new MessageEvent("message", {
        data: {
          source: "infinitesimal-service-worker",
          type: "download",
          download: { id: "address-focus-test", filename: "test.bin", url: "https://example.com/test.bin", at: new Date().toISOString() },
        },
      }));
      await new Promise(resolve => setTimeout(resolve, 100));
      if (document.activeElement !== address || address.value !== "draft.example") {
        throw new Error("A background download update interrupted address-bar typing.");
      }
      address.value = ${JSON.stringify(pageUrl)};
      document.querySelector("#omnibox-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      const deadline = Date.now() + 10_000;
      let frame;
      while (Date.now() < deadline) {
        frame = document.querySelector("#browser-mount iframe");
        if (frame && frame.getAttribute("src") !== "about:blank") {
          return JSON.stringify({
            blankUrl: hostTabUrl,
            frameSrc: frame.getAttribute("src"),
            sandbox: frame.getAttribute("sandbox"),
            referrerPolicy: frame.referrerPolicy,
          });
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error("The browser did not create a proxied frame.");
    })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (navigationResult.exceptionDetails) throw new Error(navigationResult.exceptionDetails.text);
  const navigation = JSON.parse(navigationResult.result.value);
  assert.equal(navigation.blankUrl, "about:blank");
  assert.ok(navigation.frameSrc.includes(proxyPath), `web address should encode through ${proxyEngine}`);
  const sandboxFlags = new Set(navigation.sandbox.split(/\s+/));
  for (const flag of ["allow-modals", "allow-pointer-lock", "allow-orientation-lock", "allow-presentation"]) {
    assert.ok(sandboxFlags.has(flag), `${proxyEngine}: proxied pages should support ${flag}`);
  }
  assert.equal(navigation.referrerPolicy, "strict-origin-when-cross-origin");
  const pageDeadline = Date.now() + 20_000;
  let pageTitle = "";
  let pageReadyState = "";
  while (Date.now() < pageDeadline) {
    const result = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const frame = document.querySelector("#browser-mount iframe");
        try {
          const doc = frame?.contentDocument;
          return JSON.stringify({ title: doc?.title || "", readyState: doc?.readyState || "" });
        } catch { return JSON.stringify({ title: "", readyState: "" }); }
      })()`,
      returnByValue: true,
    });
    const pageState = JSON.parse(result.result?.value || "{}");
    pageTitle = pageState.title || "";
    pageReadyState = pageState.readyState || "";
    if (pageTitle === "Example Domain" && pageReadyState === "complete") break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal(pageTitle, "Example Domain", `${proxyEngine}: ordinary proxied page should load`);
  assert.equal(pageReadyState, "complete", `${proxyEngine}: page should finish rendering before compatibility checks`);
  const pageRenderResult = await cdp.send("Runtime.evaluate", {
    expression: `JSON.stringify((() => {
      const doc = document.querySelector("#browser-mount iframe")?.contentDocument;
      const bodyRect = doc?.body?.getBoundingClientRect();
      return {
        title: doc?.title || "",
        text: doc?.body?.innerText || "",
        bodyVisible: Boolean(bodyRect && bodyRect.width > 0 && bodyRect.height > 0),
        linkCount: doc?.querySelectorAll("a[href]").length || 0,
        contentWidth: doc?.documentElement?.scrollWidth || 0,
      };
    })())`,
    returnByValue: true,
  });
  const pageRender = JSON.parse(pageRenderResult.result.value);
  assert.ok(pageRender.text.trim().length > 20, `${proxyEngine}: page text should render`);
  assert.equal(pageRender.bodyVisible, true, `${proxyEngine}: page body should have a visible layout box`);
  assert.ok(pageRender.linkCount > 0, `${proxyEngine}: links should render`);
  const redirectResult = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const adapter = window.InfinitesimalProxy;
      const frame = await adapter.createFrame("https://httpbin.org/redirect-to?url=https%3A%2F%2Fexample.com%2F");
      frame.style.cssText = "position:fixed;left:-10000px;top:0;width:320px;height:240px";
      document.body.append(frame);
      adapter.navigateFrame(frame);
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (frame.contentDocument?.title === "Example Domain" && frame.contentDocument?.readyState === "complete") {
          frame.remove();
          return "redirected";
        }
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      frame.remove();
      throw new Error("The proxied redirect did not reach Example Domain.");
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (redirectResult.exceptionDetails) throw new Error(redirectResult.exceptionDetails.text);
  assert.equal(redirectResult.result?.value, "redirected", `${proxyEngine}: redirect should reach the destination`);
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const doc = document.querySelector("#browser-mount iframe")?.contentDocument;
      if (!doc?.body) throw new Error("The proxied page is not readable from the browser surface.");
      doc.body.innerHTML = '<main><h1>Video proxy test</h1><video controls playsinline style="display:block;width:min(640px,100%)"><source src="${mediaUrl}" type="video/mp4"></video><div style="height:1400px"></div></main>';
      doc.querySelector("video").load();
    })()`,
    returnByValue: true,
  });
  const mediaDeadline = Date.now() + 20_000;
  let media;
  while (Date.now() < mediaDeadline) {
    const result = await cdp.send("Runtime.evaluate", {
      expression: `JSON.stringify((() => {
        const frame = document.querySelector("#browser-mount iframe");
        const doc = frame?.contentDocument;
        const video = doc?.querySelector("video[controls]");
        let storage = "available";
        try { doc?.defaultView.localStorage.getItem("__infinitesimal_isolation_probe__"); } catch (error) { storage = error.name; }
        return {
          title: doc?.title || "",
          url: frame?.getAttribute("src") || "",
          bodyText: doc?.body?.innerText?.slice(0, 500) || "",
          storage,
          videoCount: doc?.querySelectorAll("video").length || 0,
          nativeControls: video?.controls || false,
          readyState: video?.readyState || 0,
          networkState: video?.networkState || 0,
          duration: video && Number.isFinite(video.duration) ? video.duration : null,
          seekable: video?.seekable.length || 0,
          mediaSrc: video?.currentSrc || "",
          mediaError: video?.error ? { code: video.error.code, message: video.error.message } : null,
          scrollHeight: doc?.scrollingElement?.scrollHeight || 0
        };
      })())`,
      returnByValue: true,
    });
    const value = result.result?.value;
    media = typeof value === "string" ? JSON.parse(value) : value;
    if (media?.videoCount > 0 && media.readyState >= 1 && media.duration > 1) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!media?.videoCount || media.readyState < 1 || !(media.duration > 1)) {
    const mediaEvents = cdp.events
      .filter(event => ["Network.requestWillBeSent", "Network.loadingFailed", "Network.responseReceived"].includes(event.method))
      .map(event => event.method === "Network.loadingFailed"
        ? { method: event.method, url: event.params.requestId, error: event.params.errorText }
        : event.method === "Network.responseReceived"
          ? { method: event.method, url: event.params.response.url, status: event.params.response.status }
          : { method: event.method, url: event.params.request.url, type: event.params.type })
      .filter(event => event.url?.includes("flower") || event.error);
    throw new Error(`No browser fixture exposed playable proxied media: ${JSON.stringify({ media, mediaEvents: mediaEvents.slice(-8) })}`);
  }
  assert.equal(media.nativeControls, true);
  assert.equal(media.storage, "available", "the service-worker proxy runs on the app origin and cannot isolate localStorage");
  assert.ok(media.seekable > 0, "sample video must expose a seek range");
  assert.ok(media.mediaSrc.includes(proxyPath), `video file must be fetched through ${proxyEngine}`);

  const scrollResult = await cdp.send("Runtime.evaluate", {
    expression: `JSON.stringify((() => {
      const doc = document.querySelector("#browser-mount iframe")?.contentDocument;
      const root = doc?.scrollingElement;
      const probe = document.createElement("div");
      probe.setAttribute("aria-hidden", "true");
      probe.style.height = "1200px";
      doc.body.append(probe);
      root.scrollTop = Math.min(400, root.scrollHeight - root.clientHeight);
      return { scrollHeight: root.scrollHeight, scrollTop: root.scrollTop };
    })())`,
    returnByValue: true,
  }).then(result => JSON.parse(result.result.value));
  assert.ok(scrollResult.scrollHeight > 400);
  assert.ok(scrollResult.scrollTop > 0);

  const playbackExpression = `(async () => {
    const video = document.querySelector("#browser-mount iframe")?.contentDocument?.querySelector("video[controls]");
    if (!video || video.readyState < 2 || video.seekable.length === 0) throw new Error("The sample clip is not ready for playback.");
    await video.play();
    const startedAt = video.currentTime;
    const deadline = Date.now() + 3_000;
    while (video.currentTime <= startedAt + 0.15 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    const played = !video.paused && video.currentTime > startedAt + 0.15;
    video.pause();
    const pausedAt = video.currentTime;
    await new Promise(resolve => setTimeout(resolve, 250));
    const paused = video.paused && Math.abs(video.currentTime - pausedAt) < 0.15;
    const target = video.currentTime < video.duration * 0.5 ? video.duration * 0.7 : video.duration * 0.3;
    const seeked = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The sample did not finish seeking.")), 5_000);
      video.addEventListener("seeked", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    video.currentTime = target;
    await seeked;
    const sought = Math.abs(video.currentTime - target) < 0.2;
    if (!played || !paused || !sought) throw new Error("Playback check failed: " + JSON.stringify({ played, paused, sought }));
    return JSON.stringify({ played, paused, sought, duration: video.duration });
  })()`;
  const runPlaybackCheck = async viewportName => {
    const evaluation = await cdp.send("Runtime.evaluate", {
      expression: playbackExpression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (evaluation.exceptionDetails) throw new Error(evaluation.exceptionDetails.text);
    const value = evaluation.result?.value;
    const result = typeof value === "string" ? JSON.parse(value) : value;
    assert.equal(result.played, true, `${viewportName}: video should play`);
    assert.equal(result.paused, true, `${viewportName}: video should pause`);
    assert.equal(result.sought, true, `${viewportName}: video should seek`);
    return result;
  };
  const desktopPlayback = await runPlaybackCheck("desktop");

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobile = await cdp.send("Runtime.evaluate", {
    expression: `JSON.stringify((() => {
      const frame = document.querySelector("#browser-mount iframe");
      const doc = frame?.contentDocument;
      const video = doc?.querySelector("video[controls]");
      return { width: innerWidth, frameWidth: frame?.clientWidth || 0, videoWidth: video?.clientWidth || 0, bodyWidth: doc?.body?.scrollWidth || 0 };
    })())`,
    returnByValue: true,
  });
  const viewportValue = mobile.result?.value;
  const viewport = typeof viewportValue === "string" ? JSON.parse(viewportValue) : viewportValue;
  assert.equal(viewport.width, 390);
  assert.ok(viewport.frameWidth <= viewport.width, "mobile iframe should fit the viewport width");
  assert.ok(viewport.videoWidth <= viewport.frameWidth, "mobile video should fit the iframe width");
  assert.ok(viewport.bodyWidth <= viewport.frameWidth + 40, "mobile page should not overflow far beyond the iframe");
  const mobilePlayback = await runPlaybackCheck("mobile");

  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const doc = document.querySelector("#browser-mount iframe")?.contentDocument;
      if (!doc?.body) throw new Error("The proxied page was unavailable for interactive compatibility checks.");
      doc.body.innerHTML = '<main style="font:16px sans-serif;padding:24px"><h1>Compatibility fixture</h1><button id="fixture-button" type="button">Count click</button><output id="fixture-count">0</output><img id="fixture-image" src="https://httpbin.org/image/png" alt="Remote image" style="display:block;width:64px;height:64px;margin:16px 0"></main>';
      const count = doc.querySelector("#fixture-count");
      doc.querySelector("#fixture-button").addEventListener("click", () => { count.textContent = String(Number(count.textContent) + 1); });
      const css = doc.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://www.w3.org/StyleSheets/base.css";
      doc.head.append(css);
      const font = doc.createElement("link");
      font.rel = "stylesheet";
      font.href = "https://fonts.googleapis.com/css2?family=Roboto:wght@400&display=swap";
      doc.head.append(font);
    })()`,
    returnByValue: true,
  });
  const compatibility = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const doc = document.querySelector("#browser-mount iframe")?.contentDocument;
      doc?.querySelector("#fixture-button")?.click();
      const image = doc?.querySelector("#fixture-image");
      const imageRect = image?.getBoundingClientRect();
      return {
        count: doc?.querySelector("#fixture-count")?.textContent || "",
        imageUrl: image?.src || "",
        imageVisible: Boolean(imageRect && imageRect.width > 0),
        stylesheet: [...(doc?.querySelectorAll('link[rel="stylesheet"]') || [])].some(link => link.href.includes("w3.org/StyleSheets/base.css")),
        font: [...(doc?.querySelectorAll('link[rel="stylesheet"]') || [])].some(link => link.href.includes("fonts.googleapis.com")),
      };
    })()`,
    returnByValue: true,
  });
  assert.equal(compatibility.result?.value.count, "1", `${proxyEngine}: interactive page button should respond`);
  assert.ok(compatibility.result?.value.imageUrl.startsWith("https://"), `${proxyEngine}: remote image should be requested`);
  assert.equal(compatibility.result?.value.imageVisible, true, `${proxyEngine}: remote image should reserve a visible layout box`);
  assert.equal(compatibility.result?.value.stylesheet, true, `${proxyEngine}: remote stylesheet should be present`);
  assert.equal(compatibility.result?.value.font, true, `${proxyEngine}: remote font should be present`);

  const newTabRedirect = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const before = document.querySelectorAll(".tabbar .tab").length;
      const doc = document.querySelector("#browser-mount iframe")?.contentDocument;
      if (!doc?.body) throw new Error("The active proxied page is unavailable for the new-tab redirect test.");
      const link = doc.createElement("a");
      link.href = "https://httpbin.org/redirect-to?url=https%3A%2F%2Fexample.com%2F";
      link.target = "_blank";
      link.textContent = "Open redirected destination";
      doc.body.append(link);
      link.click();
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const active = document.querySelector("#browser-mount iframe");
        if (document.querySelectorAll(".tabbar .tab").length === before + 1 && active?.contentDocument?.title === "Example Domain") {
          return "opened-in-app-tab";
        }
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      throw new Error("A _blank redirect link did not open its destination in a new Infinitesimal tab.");
    })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (newTabRedirect.exceptionDetails) throw new Error(newTabRedirect.exceptionDetails.text);
  assert.equal(newTabRedirect.result?.value, "opened-in-app-tab", `${proxyEngine}: _blank redirect should open a new app tab`);

  const retryStart = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const state = JSON.parse(localStorage.getItem("infinitesimal.workspace.v1") || "{}");
      const tab = state.tabs?.find(item => item.id === state.activeTab);
      const button = document.querySelector('[data-action="retry-other-engine"]');
      if (!tab || !button) throw new Error("The page-level alternate-engine action was unavailable.");
      const result = { tabId: tab.id, url: tab.url, engine: localStorage.getItem("infinitesimal.workspace.v1.proxyEngine") || "${proxyEngine}" };
      button.click();
      return JSON.stringify(result);
    })()`,
    returnByValue: true,
  });
  const retrySnapshot = JSON.parse(retryStart.result.value);
  const alternateEngine = proxyEngine === "uv" ? "scramjet" : "uv";
  const retryDeadline = Date.now() + 30_000;
  let retryState;
  while (Date.now() < retryDeadline) {
    const result = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const state = JSON.parse(localStorage.getItem("infinitesimal.workspace.v1") || "{}");
        const tab = state.tabs?.find(item => item.id === state.activeTab);
        const frame = document.querySelector("#browser-mount iframe");
        return {
          engine: localStorage.getItem("infinitesimal.workspace.v1.proxyEngine"),
          tabId: tab?.id || "",
          url: tab?.url || "",
          title: (() => { try { return frame?.contentDocument?.title || ""; } catch { return ""; } })(),
          src: frame?.getAttribute("src") || "",
        };
      })()`,
      returnByValue: true,
    });
    retryState = result.result?.value;
    if (retryState?.engine === alternateEngine && retryState.tabId === retrySnapshot.tabId && retryState.url === retrySnapshot.url && retryState.title === "Example Domain") break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal(retryState?.engine, alternateEngine, `${proxyEngine}: page retry should switch to the alternate engine`);
  assert.equal(retryState?.tabId, retrySnapshot.tabId, `${proxyEngine}: page retry should preserve the selected tab`);
  assert.equal(retryState?.url, retrySnapshot.url, `${proxyEngine}: page retry should preserve the destination URL`);
  assert.ok(retryState?.src.includes(alternateEngine === "uv" ? "/uv/service/" : "/scram/service/"), `${proxyEngine}: retried page should use the alternate engine`);
  process.stdout.write(`Infinitesimal browser test passed (${proxyEngine}): redirected navigation, interactive content, remote assets, media controls, and page-level engine retry.\n`);
} catch (error) {
  throw new Error(`Infinitesimal browser test failed: ${error.message}`);
} finally {
  cdp?.close();
  browser.kill("SIGTERM");
  app.kill("SIGTERM");
  await Promise.all([browser, app].map(async child => {
    if (child.exitCode !== null) return;
    await Promise.race([once(child, "close"), new Promise(resolve => setTimeout(resolve, 2_000))]);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await Promise.race([once(child, "close"), new Promise(resolve => setTimeout(resolve, 2_000))]);
    }
  }));
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
}
