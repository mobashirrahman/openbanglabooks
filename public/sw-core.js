/*
 * OpenBanglaBooks service worker (loaded by /sw.js, which sets self.OBB_BUILD).
 *
 * What it does, and nothing more:
 * - Pages (navigations): network first. Every page that loads is kept, so a
 *   page read once opens again without a network. With no network and no
 *   copy, the offline page is shown (it lists the books on this device).
 * - Build assets, fonts and icons: cache first. Their names never change
 *   meaning (content-hashed or immutable), so a kept copy is always right.
 * - Everything else (API, book files, the account, other sites) is not
 *   touched. Book files already live in IndexedDB.
 *
 * Pages reference the scripts of the build that rendered them, so the page
 * copies are kept per build. When a new build takes over, the pages kept by
 * the old one are fetched again from the new server and only then dropped.
 */

const BUILD = self.OBB_BUILD || "dev";
const PAGES = `obb-pages-${BUILD}`;
const STATIC = "obb-static-v1";
const PAGES_PREFIX = "obb-pages-";
const OFFLINE = { bn: "/offline", en: "/en/offline" };
const STATIC_MAX = 500;
const PAGES_MAX = 150;

const sameOrigin = (url) => url.origin === self.location.origin;
const isEnglish = (path) => path === "/en" || path.startsWith("/en/");
const barePath = (path) => (isEnglish(path) ? path.slice(3) || "/" : path);
const isReader = (path) => barePath(path).startsWith("/read/");
/** never kept: private, per-request or one-time pages */
const isPrivate = (path) => {
  const p = barePath(path);
  return p === "/admin" || p.startsWith("/admin/") || p.startsWith("/api/") || p.startsWith("/signin/confirm");
};
const isStaticAsset = (url) =>
  url.pathname.startsWith("/_next/static/") ||
  /^\/(fonts|brand|icons)\//.test(url.pathname) ||
  ["/favicon.ico", "/icon.svg", "/apple-icon.png", "/manifest.webmanifest"].includes(url.pathname);

/** Pages are kept by path: a reader link's ?cfi= is read by the page itself. */
const pageKey = (url) => `${url.origin}${url.pathname}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGES);
      await Promise.all(Object.values(OFFLINE).map((p) => keepPage(cache, new URL(p, self.location.origin)).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
      await self.clients.claim();
    })(),
  );
  // not inside waitUntil: fetches must not wait for this
  void migrate();
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "warm" && Array.isArray(data.urls)) event.waitUntil(warm(data.urls, data.assets || []));
  else if (data.type === "clear") event.waitUntil(clearAll());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!sameOrigin(url)) return;
  if (req.mode === "navigate") {
    if (isPrivate(url.pathname)) return;
    event.respondWith(navigate(event, url));
  } else if (isStaticAsset(url) && !url.search) {
    event.respondWith(staticFirst(event, req));
  }
});

async function navigate(event, url) {
  const cache = await caches.open(PAGES);
  try {
    const res = (await event.preloadResponse) || (await fetch(event.request));
    if (keepable(res)) {
      if (!url.search) event.waitUntil(cache.put(pageKey(url), res.clone()).then(() => trim(cache, PAGES_MAX)));
      // a reader link with ?cfi= or ?at=: keep the plain book page instead
      else if (isReader(url.pathname)) event.waitUntil(cache.match(pageKey(url)).then((hit) => hit || keepPage(cache, new URL(url.pathname, url.origin))));
    }
    return res;
  } catch {
    const hit = await cache.match(pageKey(url));
    if (hit) return hit;
    const offline = await cache.match(new URL(isEnglish(url.pathname) ? OFFLINE.en : OFFLINE.bn, url.origin).href);
    if (offline) return offline;
    return new Response("<!doctype html><meta charset=utf-8><title>Offline</title><p>অফলাইন — Offline", {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

function keepable(res) {
  return res && res.ok && res.status === 200 && res.type === "basic" && !res.redirected && (res.headers.get("content-type") || "").includes("text/html");
}

async function staticFirst(event, req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.status === 200 && res.type === "basic") event.waitUntil(cache.put(req, res.clone()).then(() => trim(cache, STATIC_MAX)));
  return res;
}

/** Fetches a page into the cache, and the build assets it references. */
async function keepPage(cache, url) {
  const res = await fetch(url.href, { credentials: "same-origin", cache: "no-cache" });
  if (!keepable(res)) return;
  const html = await res.clone().text();
  await cache.put(pageKey(url), res);
  await keepAssets(assetsIn(html));
}

const ASSET_RE = /\/_next\/static\/[^"'\s)\\]+/g;
function assetsIn(html) {
  return [...new Set(html.match(ASSET_RE) || [])];
}

async function keepAssets(paths) {
  if (!paths.length) return;
  const cache = await caches.open(STATIC);
  await Promise.all(
    paths.map(async (p) => {
      const req = new Request(new URL(p, self.location.origin).href);
      if (await cache.match(req)) return;
      try {
        const res = await fetch(req);
        if (res.ok && res.status === 200) await cache.put(req, res);
      } catch {
        /* offline: the next visit fills it */
      }
    }),
  );
}

/** Pages the app asks to have ready offline (its shell, the page being read), and assets such as reader fonts. */
async function warm(urls, assets) {
  const cache = await caches.open(PAGES);
  for (const u of urls.slice(0, 20)) {
    const url = new URL(u, self.location.origin);
    if (!sameOrigin(url) || isPrivate(url.pathname)) continue;
    url.search = "";
    if (await cache.match(pageKey(url))) continue;
    await keepPage(cache, url).catch(() => {});
  }
  const own = assets.filter((a) => typeof a === "string" && a.startsWith("/") && isStaticAsset(new URL(a, self.location.origin)));
  await keepAssets(own.slice(0, 400)).catch(() => {});
}

let migrating = null;
/** Moves the pages kept by older builds into this build's cache, fetched fresh. */
function migrate() {
  migrating ??= (async () => {
    const names = (await caches.keys()).filter((n) => n.startsWith(PAGES_PREFIX) && n !== PAGES);
    if (!names.length) return;
    const cache = await caches.open(PAGES);
    for (const name of names) {
      const old = await caches.open(name);
      const keys = await old.keys();
      for (const req of keys.slice(-PAGES_MAX)) {
        const url = new URL(req.url);
        if (await cache.match(pageKey(url))) continue;
        try {
          await keepPage(cache, url);
        } catch {
          return; // offline: keep the old copies until the next start
        }
      }
      await caches.delete(name);
    }
  })().finally(() => {
    migrating = null;
  });
  return migrating;
}
// the worker may have been stopped halfway through a migration (only the
// active worker migrates: an installing one would pull pages from under it)
if (self.serviceWorker && self.serviceWorker.state === "activated") void migrate();

async function trim(cache, max) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}

async function clearAll() {
  for (const name of await caches.keys()) if (name.startsWith("obb-")) await caches.delete(name);
}
