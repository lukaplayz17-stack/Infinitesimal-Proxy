(function (scope) {
  const DB_NAME = "infinitesimal-browser";
  const STORE_NAME = "state";
  const POLICY_KEY = "school-policy";

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function readPolicy() {
    try {
      const db = await openDb();
      const value = await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(POLICY_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return value;
    } catch {
      return null;
    }
  }

  async function writeDownload(download) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const store = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
      const request = store.get("downloads");
      request.onsuccess = () => {
        const records = Array.isArray(request.result) ? request.result : [];
        records.unshift(download);
        store.put(records.slice(0, 100), "downloads");
      };
      request.onerror = () => reject(request.error);
      store.transaction.oncomplete = resolve;
      store.transaction.onerror = () => reject(store.transaction.error);
    });
    db.close();
  }

  function matchesDomain(host, entry) {
    const domain = String(entry || "").trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
    if (!domain) return false;
    return host === domain || host.endsWith(`.${domain}`);
  }

  function isBlocked(target, policy) {
    if (!target || !policy?.active || !policy.sessionUntil || Date.now() >= policy.sessionUntil) return false;
    let host;
    try {
      host = new URL(target).hostname.toLowerCase().replace(/\.$/, "");
    } catch {
      return false;
    }
    const allowlist = Array.isArray(policy.allowlist) ? policy.allowlist : [];
    const blocklist = Array.isArray(policy.blocklist) ? policy.blocklist : [];
    const isAllowed = allowlist.some((entry) => matchesDomain(host, entry));
    if (policy.mode === "strict" && !isAllowed) return true;
    if (isAllowed) return false;
    return blocklist.some((entry) => matchesDomain(host, entry));
  }

  function blockedResponse(request) {
    if (request.mode !== "navigate") return new Response("", { status: 204 });
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Blocked during your study session</title><style>body{margin:0;background:#101b2b;color:#e8edf0;font:16px system-ui;display:grid;min-height:100vh;place-items:center}.card{max-width:34rem;padding:2rem;text-align:center;border:1px solid #334557;border-radius:18px;background:#172638}p{color:#b0bdc8;line-height:1.6}a{color:#e5cda6}</style><main class="card"><h1>Blocked during your study session</h1><p>This site is restricted by the study session on this browser.</p><a href="/">Return to Infinitesimal</a></main></html>`;
    return new Response(html, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  async function trackDownload(event, target, response) {
    const disposition = response.headers.get("content-disposition") || "";
    const contentType = response.headers.get("content-type") || "";
    const isAttachment = /attachment/i.test(disposition) || (!/^(text\/|application\/(json|javascript|xml|xhtml\+xml)|image\/|audio\/|video\/)/i.test(contentType) && !!contentType);
    if (!isAttachment) return;
    const match = disposition.match(/filename\*?=(?:UTF-8''|["']?)([^;"']+)/i);
    const filename = match ? decodeURIComponent(match[1].trim().replace(/^["']|["']$/g, "")) : "";
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      filename: filename || (target ? new URL(target).pathname.split("/").pop() : "") || "Download",
      url: target,
      size: Number(response.headers.get("content-length")) || null,
      status: "Started",
      at: new Date().toISOString(),
    };
    try {
      await writeDownload(record);
      const clients = await scope.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) client.postMessage({ source: "infinitesimal-service-worker", type: "download", download: record });
    } catch {
      // A blocked storage context must not stop a real proxied response.
    }
  }

  scope.infinitesimalReadPolicy = readPolicy;
  scope.infinitesimalIsBlocked = isBlocked;
  scope.infinitesimalBlockedResponse = blockedResponse;
  scope.infinitesimalTrackDownload = trackDownload;
})(self);
