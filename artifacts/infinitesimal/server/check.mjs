import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const require = createRequire(import.meta.url);
const engine = process.env.PROXY_ENGINE || "uv";

if (!["uv", "scramjet"].includes(engine)) {
  throw new Error(`PROXY_ENGINE must be "uv" or "scramjet"; received "${engine}".`);
}

const imports = [
  "@titaniumnetwork-dev/ultraviolet",
  "@mercuryworkshop/bare-mux/node",
  "@mercuryworkshop/epoxy-transport",
  "@mercuryworkshop/scramjet/path",
  "@mercuryworkshop/libcurl-transport",
  "@mercuryworkshop/wisp-js/server",
  "express",
  "ws",
];

for (const name of imports) {
  try {
    require.resolve(name);
  } catch (error) {
    throw new Error(`Required package import "${name}" does not resolve: ${error.message}`);
  }
}

const common = [
  "index.html",
  "css/app.css",
  "js/app.js",
  "js/proxy.js",
  "js/policy.js",
  "js/policy-worker.js",
];
const engineFiles =
  engine === "uv"
    ? [
        "uv/sw.js",
        "uv/uv.config.js",
        "node_modules/@titaniumnetwork-dev/ultraviolet/dist/sw.js",
        "node_modules/@titaniumnetwork-dev/ultraviolet/dist/uv.bundle.js",
        "node_modules/@titaniumnetwork-dev/ultraviolet/dist/uv.client.js",
        "node_modules/@titaniumnetwork-dev/ultraviolet/dist/uv.handler.js",
        "node_modules/@titaniumnetwork-dev/ultraviolet/dist/uv.sw.js",
        "node_modules/@mercuryworkshop/epoxy-transport/dist/index.mjs",
        "node_modules/@mercuryworkshop/bare-mux/dist/index.js",
        "node_modules/@mercuryworkshop/bare-mux/dist/worker.js",
      ]
    : [
        "sw.js",
        "config.js",
        "node_modules/@mercuryworkshop/scramjet/dist/scramjet.all.js",
        "node_modules/@mercuryworkshop/scramjet/dist/scramjet.sync.js",
        "node_modules/@mercuryworkshop/scramjet/dist/scramjet.wasm.wasm",
        "node_modules/@mercuryworkshop/libcurl-transport/dist/index.mjs",
        "node_modules/@mercuryworkshop/bare-mux/dist/index.js",
        "node_modules/@mercuryworkshop/bare-mux/dist/worker.js",
      ];

const missing = [];
for (const relative of [...common, ...engineFiles]) {
  const file = relative.startsWith("node_modules/")
    ? path.join(root, relative)
    : path.join(publicDir, relative);
  try {
    await access(file);
  } catch {
    missing.push(relative);
  }
}

if (missing.length) {
  throw new Error(
    `The ${engine} proxy engine is missing required served files:\n${missing.map((file) => ` - ${file}`).join("\n")}`,
  );
}

console.info(`Infinitesimal check passed for ${engine}: imports resolve and required static assets exist.`);
