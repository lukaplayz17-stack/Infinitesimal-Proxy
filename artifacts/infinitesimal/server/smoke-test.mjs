import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const serverScript = fileURLToPath(new URL("./index.mjs", import.meta.url));
const engines = {
  uv: [
    "/uv/uv.bundle.js",
    "/uv/uv.sw.js",
    "/epoxy/index.mjs",
    "/baremux/worker.js",
  ],
  scramjet: [
    "/scram/scramjet.all.js",
    "/scram/scramjet.sync.js",
    "/scram/scramjet.wasm.wasm",
    "/libcurl/index.mjs",
  ],
};

async function freePort() {
  const socketServer = createServer();
  socketServer.listen(0, "127.0.0.1");
  await once(socketServer, "listening");
  const { port } = socketServer.address();
  await new Promise((resolve, reject) => socketServer.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(url, child) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < 20_000) {
    if (child.exitCode !== null) throw new Error(`Server exited early (${child.exitCode}).`);
    try {
      const response = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
      lastError = new Error(`Health check returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not become healthy: ${lastError?.message || "startup timed out"}`);
}

async function verifyEngine(engine, vendorPaths) {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      PORT: String(port),
      PROXY_ENGINE: engine,
      NODE_ENV: "test",
      AI_PROVIDER: "",
      GROQ_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { output += chunk; });
  try {
    await waitForServer(baseUrl, child);

    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200, `${engine}: health endpoint`);
    assert.deepEqual(await health.json(), { status: "ok" }, `${engine}: health payload`);

    const configResponse = await fetch(`${baseUrl}/config.json`);
    assert.equal(configResponse.status, 200, `${engine}: config endpoint`);
    const config = await configResponse.json();
    assert.equal(config.proxyEngine, engine, `${engine}: configured engine`);
    assert.match(config.wispUrl, /^ws:\/\/127\.0\.0\.1:/, `${engine}: local Wisp address`);
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(config.wispUrl);
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error(`${engine}: Wisp WebSocket handshake timed out.`));
      }, 5_000);
      socket.once("open", () => {
        clearTimeout(timer);
        socket.close();
        resolve();
      });
      socket.once("error", error => {
        clearTimeout(timer);
        reject(new Error(`${engine}: Wisp WebSocket handshake failed: ${error.message}`));
      });
    });

    const page = await fetch(baseUrl);
    assert.equal(page.status, 200, `${engine}: public application entry`);
    assert.match(await page.text(), /type="module"/, `${engine}: plain module-based client`);

    const commonPaths = ["/js/app.js", "/js/proxy.js", "/js/policy.js", "/js/policy-worker.js", "/sw.js", "/uv/sw.js"];
    for (const path of [...commonPaths, ...vendorPaths]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 200, `${engine}: asset ${path}`);
      assert.ok(Number(response.headers.get("content-length")) !== 0, `${engine}: non-empty asset ${path}`);
    }

    const emptySuggestions = await fetch(`${baseUrl}/api/suggest`);
    assert.equal(emptySuggestions.status, 200, `${engine}: empty suggestion request`);
    assert.deepEqual(await emptySuggestions.json(), { suggestions: [] }, `${engine}: empty suggestions`);

    const invalidTranslation = await fetch(`${baseUrl}/api/translate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "", target: "es" }),
    });
    assert.equal(invalidTranslation.status, 400, `${engine}: translation validation`);

    const unconfiguredAi = await fetch(`${baseUrl}/api/ai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
    });
    assert.equal(unconfiguredAi.status, 503, `${engine}: AI setup guidance`);
    assert.match((await unconfiguredAi.json()).error, /GROQ_API_KEY/, `${engine}: Groq setup guidance`);
  } catch (error) {
    throw new Error(`${engine} smoke test failed: ${error.message}\n${output}`);
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null) {
      await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 3_000))]);
    }
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

for (const [engine, paths] of Object.entries(engines)) {
  await verifyEngine(engine, paths);
  process.stdout.write(`Infinitesimal ${engine} server smoke test passed.\n`);
}
