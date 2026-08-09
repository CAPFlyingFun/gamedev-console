/*
 * SCOPE-RELATIVE, AND NETWORK-FIRST FOR THE SHELL.
 *
 * Two things this worker must not assume. The first is that the app sits at
 * the site root: it is served from /gamedev-console/ on GitHub Pages, so
 * every path here is derived from the worker's own location instead of being
 * written as '/'. Registering the old ASSETS list from a subpath cached the
 * HOST SITE's home page under the console's name and never cached the
 * console at all.
 *
 * The second is that a cached page is still the right page. The shell was
 * cache-first, which pins the console to whichever version happened to load
 * on the very first visit and never updates it again — you push a change,
 * reload, and see the old app. The shell is now fetched fresh whenever the
 * network answers, with the cache kept strictly as the offline fallback.
 *
 * Hashed build assets are the exception and stay cache-first: their file
 * names change on every build, so a cached one can never be stale.
 */
const CACHE_NAME = 'gamedev-console-v2';

/* The directory this worker was served from — "/gamedev-console/" or "/". */
const ROOT = new URL('./', self.location).pathname;
const SHELL = [ROOT, `${ROOT}index.html`];
const ASSET_DIR = `${ROOT}assets/`;

const API_HOSTS = ['api.openai.com', 'api.anthropic.com', 'api.github.com'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

/** Save a copy without making the caller wait on the write. */
function remember(request, response) {
  if (!response || !response.ok) return response;
  const copy = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
  return response;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  /* Never intercept API requests — keys, streaming and CORS are theirs. */
  if (API_HOSTS.includes(url.hostname)) return;
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  /* Immutable, content-hashed bundles: serve from cache, fill on first miss. */
  if (url.pathname.startsWith(ASSET_DIR)) {
    event.respondWith(
      caches.match(event.request).then((hit) => hit
        || fetch(event.request).then((res) => remember(event.request, res))),
    );
    return;
  }

  const isShell = event.request.mode === 'navigate' || SHELL.includes(url.pathname);
  if (!isShell) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => remember(event.request, res))
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match(ROOT))),
  );
});
