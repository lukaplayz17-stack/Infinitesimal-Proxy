importScripts("/uv/uv.bundle.js", "/uv/uv.config.js", "/js/policy-worker.js");
importScripts(self.__uv$config.sw || "/uv/uv.sw.js");

const uv = new UVServiceWorker();

function proxiedTarget(request) {
  try {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith(self.__uv$config.prefix)) return "";
    const encoded = pathname.slice(self.__uv$config.prefix.length);
    return self.__uv$config.decodeUrl(decodeURIComponent(encoded));
  } catch {
    return "";
  }
}

async function handleRequest(event) {
  if (!uv.route(event)) return fetch(event.request);

  const target = proxiedTarget(event.request);
  const policy = await self.infinitesimalReadPolicy();
  if (self.infinitesimalIsBlocked(target, policy)) {
    return self.infinitesimalBlockedResponse(event.request);
  }

  const response = await uv.fetch(event);
  await self.infinitesimalTrackDownload(event, target, response);
  return response;
}

self.addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});
