importScripts("/config.js", "/scram/scramjet.all.js", "/js/policy-worker.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const SCRAMJET_DB = "$scramjet";
const SCRAMJET_STORES = ["config", "cookies", "redirectTrackers", "referrerPolicies", "publicSuffixList"];
const SCRAMJET_PREFIX = "/scram/service/";

function createScramjetStores(db) {
  for (const name of SCRAMJET_STORES) {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));
  });
}

async function readStore(db, name) {
  const transaction = db.transaction(name, "readonly");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(name);
  const [keys, values] = await Promise.all([
    requestResult(store.getAllKeys()),
    requestResult(store.getAll()),
  ]);
  await done;
  return keys.map((key, index) => [key, values[index]]);
}

async function openScramjetDb() {
  const request = indexedDB.open(SCRAMJET_DB);
  request.onupgradeneeded = () => createScramjetStores(request.result);
  return requestResult(request);
}

async function deleteScramjetDb() {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(SCRAMJET_DB);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error || new Error("Could not repair Scramjet storage."));
    request.onblocked = () => reject(new Error("Close other Infinitesimal tabs to repair Scramjet storage."));
  });
}

async function prepareScramjetDb() {
  let db = await openScramjetDb();
  const missing = SCRAMJET_STORES.filter(name => !db.objectStoreNames.contains(name));
  if (!missing.length) {
    db.close();
    return;
  }
  if (db.version !== 1) {
    db.close();
    throw new Error(`Scramjet storage schema version ${db.version} is unsupported.`);
  }

  // Scramjet 1.1 opens this database before the controller creates its stores.
  // Repair that empty/partial v1 database before constructing its worker client.
  const existing = {};
  for (const name of Array.from(db.objectStoreNames)) existing[name] = await readStore(db, name);
  db.close();
  await deleteScramjetDb();

  db = await openScramjetDb();
  for (const [name, rows] of Object.entries(existing)) {
    if (!rows.length) continue;
    const transaction = db.transaction(name, "readwrite");
    const done = transactionDone(transaction);
    for (const [key, value] of rows) transaction.objectStore(name).put(value, key);
    await done;
  }
  db.close();
}

let scramjetRuntimeConfigured = false;
const scramjetReady = prepareScramjetDb().then(() => {
  const client = new ScramjetServiceWorker();
  self.addEventListener("message", event => {
    if (event.data?.scramjet$type !== "loadConfig") return;
    queueMicrotask(() => {
      if (client.config === event.data.config) {
        // Scramjet 1.1 assigns this.config from the message without initializing its
        // module-level URL-rewriter config. Force the next fetch through loadConfig().
        client.config = undefined;
        scramjetRuntimeConfigured = false;
      }
    });
  });
  return client;
});

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

function proxiedTarget(request) {
  try {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(scramjet.config.prefix)) return "";
    const encoded = url.pathname.slice(scramjet.config.prefix.length);
    return scramjet.config.codec.decode(decodeURIComponent(encoded));
  } catch {
    return "";
  }
}

async function handleRequest(event) {
  const scramjet = await scramjetReady;
  if (!scramjetRuntimeConfigured) {
    scramjet.config = undefined;
    await scramjet.loadConfig();
    scramjetRuntimeConfigured = true;
  }
  if (!scramjet.route(event)) return fetch(event.request);

  const target = proxiedTarget(event.request);
  const policy = await self.infinitesimalReadPolicy();
  if (self.infinitesimalIsBlocked(target, policy)) {
    return self.infinitesimalBlockedResponse(event.request);
  }

  const response = await scramjet.fetch(event);
  await self.infinitesimalTrackDownload(event, target, response);
  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(SCRAMJET_PREFIX) && url.pathname !== "/scram/scramjet.wasm.wasm") return;
  event.respondWith(handleRequest(event));
});
