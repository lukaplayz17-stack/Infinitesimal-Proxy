const DB_NAME = "infinitesimal-browser";
const STORE_NAME = "state";

function openPolicyDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeState(key, value) {
  const db = await openPolicyDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function readState(key) {
  const db = await openPolicyDb();
  const value = await new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

window.InfinitesimalPolicy = {
  save: (policy) => writeState("school-policy", policy),
  load: () => readState("school-policy"),
  downloads: () => readState("downloads").then((records) => Array.isArray(records) ? records : []),
  saveDownloads: (records) => writeState("downloads", Array.isArray(records) ? records : []),
  files: () => readState("music-files").then((records) => Array.isArray(records) ? records : []),
  saveFiles: (records) => writeState("music-files", Array.isArray(records) ? records : []),
};
