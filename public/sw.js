/*
 * SurahSpot service worker.
 *
 * Hand-written rather than generated, for two reasons: the app ships with no
 * runtime dependencies beyond Next and React, and the caching rules here are
 * correctness-sensitive enough to be worth reading directly.
 *
 * Three jobs:
 *   1. Make the app open instantly and work offline for Surahs already read.
 *   2. Keep mobile data use down by never refetching immutable content.
 *   3. Receive push notifications and open the right screen when tapped.
 *
 * The cache names carry a version. Bumping CACHE_VERSION retires every old
 * cache on the next activation, which is the upgrade path for a change in
 * these rules.
 */

const CACHE_VERSION = "v1";
const SHELL_CACHE = `surahspot-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `surahspot-static-${CACHE_VERSION}`;
const QURAN_CACHE = `surahspot-quran-${CACHE_VERSION}`;
const PAGE_CACHE = `surahspot-pages-${CACHE_VERSION}`;

const OWNED_CACHES = [SHELL_CACHE, STATIC_CACHE, QURAN_CACHE, PAGE_CACHE];

/**
 * How many Qur'an responses to keep. Roughly a Juz of reading; the largest
 * single Surah response is about 83KB uncompressed, most are far smaller, so
 * this stays comfortably inside a few megabytes.
 */
const MAX_QURAN_ENTRIES = 40;

/** How many visited pages to keep for offline navigation. */
const MAX_PAGE_ENTRIES = 12;

/**
 * Precached on install. Deliberately short: Next's JS and CSS live at hashed
 * URLs this file cannot know, so they are cached on first use instead. These
 * are the stable URLs that make an offline launch possible at all.
 */
const SHELL_ASSETS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/fonts/UthmanicHafs1Ver18.ttf",
  "/icon-192.png",
  "/icon-512.png",
  "/badge-96.png",
];

/* ==========================================================================
   Request classification
   Exposed on self for the unit tests, which load this file and assert the
   rules directly rather than re-implementing them.
   ========================================================================== */

/**
 * Endpoints that must never be cached.
 *
 * /api/quran/round carries the answer to the current round, so a cached copy
 * would hand out answers. The audio route serves range requests, which a
 * naive cache would corrupt into unseekable media. The rest are either
 * per-request state or already declared no-store by the server.
 */
function isNeverCached(pathname) {
  return (
    pathname.startsWith("/api/quran/round")
    || pathname.startsWith("/api/quran/audio")
    || pathname.startsWith("/api/quran/search")
    || pathname.startsWith("/api/quran/translate")
    || pathname.startsWith("/api/quran/config")
    || pathname.startsWith("/api/game")
    || pathname.startsWith("/api/health")
    || pathname.startsWith("/api/share")
    || pathname.startsWith("/api/notifications")
  );
}

/** Immutable build output and vendored assets: safe to keep indefinitely. */
function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/")
    || pathname.startsWith("/fonts/")
    || pathname.startsWith("/brand/")
    || pathname.startsWith("/images/")
    || pathname.startsWith("/pwa/")
    || pathname === "/manifest.webmanifest"
    || /^\/(icon-|badge-|apple-touch-icon)/.test(pathname)
  );
}

/**
 * Qur'an content. The text does not change, and a translation only changes if
 * the resource itself is revised, so these are served from cache and refreshed
 * in the background.
 */
function isQuranContent(pathname) {
  return pathname.startsWith("/api/quran/learning/");
}

function classifyRequest(request) {
  if (request.method !== "GET") return "bypass";

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return "bypass";
  }

  if (url.origin !== self.location.origin) return "bypass";

  /*
   * React Server Component payloads vary on headers this worker does not key
   * on, so a cached copy could be served for the wrong route. They are left to
   * the network; full page loads still work offline from the page cache.
   */
  if (url.searchParams.has("_rsc")) return "bypass";
  if (request.headers.get("RSC") === "1") return "bypass";

  if (isNeverCached(url.pathname)) return "bypass";
  if (isStaticAsset(url.pathname)) return "static";
  if (isQuranContent(url.pathname)) return "quran";
  if (request.mode === "navigate") return "navigate";

  return "bypass";
}

self.__swPolicy = { classifyRequest, isNeverCached, isStaticAsset, isQuranContent };

/* ==========================================================================
   Cache helpers
   ========================================================================== */

/**
 * Keep a cache bounded, evicting least-recently-added first.
 *
 * The Cache API preserves insertion order, and every write deletes the key
 * before putting it back, so "oldest key" means "least recently used".
 */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}

/**
 * A copy of `headers` with one more entry.
 *
 * A Request's headers are immutable once it exists, so a conditional
 * revalidation has to be built from a fresh copy rather than mutated in place.
 */
function appendHeader(headers, name, value) {
  const copy = new Headers(headers);
  copy.set(name, value);
  return copy;
}

async function putWithLru(cacheName, request, response, maxEntries) {
  const cache = await caches.open(cacheName);
  // Delete first so the re-insert moves this entry to the end of the order.
  await cache.delete(request);
  await cache.put(request, response);
  await trimCache(cacheName, maxEntries);
}

/** Cache-first: immutable assets never need a network round trip. */
async function serveStatic(request) {
  const cached = await caches.match(request, { cacheName: STATIC_CACHE });
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

/**
 * Stale-while-revalidate: a Surah already read opens instantly and costs no
 * data, while a fresh copy is fetched in the background for next time.
 */
async function serveQuran(request) {
  const cached = await caches.match(request, { cacheName: QURAN_CACHE });

  /*
   * Revalidate against the copy already held, rather than refetching it.
   *
   * Stale-while-revalidate without this is quietly expensive: the reader gets
   * the cached Surah instantly, but the background refresh still pulls the
   * whole payload down every single time. The reading routes return a strong
   * ETag, so asking conditionally turns that refresh into a 304 — and the
   * Qur'an text does not change, so in practice it always is one.
   */
  const revalidation = cached?.headers.get("ETag");
  const networkRequest = revalidation
    ? new Request(request, { headers: appendHeader(request.headers, "If-None-Match", revalidation) })
    : request;

  const network = fetch(networkRequest)
    .then(async (response) => {
      // 304 means the cached copy is current: nothing to store, nothing to
      // hand back — the caller is already being served from the cache.
      if (response.ok) {
        await putWithLru(QURAN_CACHE, request, response.clone(), MAX_QURAN_ENTRIES);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Refresh in the background; the reader gets the cached copy immediately.
    network.catch(() => {});
    return cached;
  }

  const response = await network;
  if (response) return response;

  return new Response(
    JSON.stringify({ error: "This Surah has not been downloaded yet, and you appear to be offline." }),
    { status: 503, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Network-first for pages, so a reader online always gets the current build,
 * with the last successful copy of that page as the offline fallback.
 */
async function serveNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      await putWithLru(PAGE_CACHE, request, response.clone(), MAX_PAGE_ENTRIES);
    }
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: PAGE_CACHE });
    if (cached) return cached;

    const offline = await caches.match("/offline.html", { cacheName: SHELL_CACHE });
    if (offline) return offline;

    return new Response("You are offline.", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

/* ==========================================================================
   Lifecycle
   ========================================================================== */

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // One missing asset must not fail the whole install, or the worker never
    // activates and the app silently loses offline support.
    await Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset)));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith("surahspot-") && !OWNED_CACHES.includes(name))
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

/*
 * The page decides when to apply an update, so the reader is never swapped
 * mid-Ayah. It posts SKIP_WAITING once the person accepts.
 */
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const kind = classifyRequest(event.request);
  if (kind === "bypass") return;

  if (kind === "static") event.respondWith(serveStatic(event.request));
  else if (kind === "quran") event.respondWith(serveQuran(event.request));
  else if (kind === "navigate") event.respondWith(serveNavigation(event.request));
});

/* ==========================================================================
   Push notifications
   ========================================================================== */

/**
 * Notifications arrive fully formed from the server: title, body and where to
 * go when tapped. The worker does no content selection of its own, so what is
 * shown cannot drift from what was scheduled.
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "SurahSpot";
  const options = {
    body: payload.body || "",
    // A category tag means a newer notification of the same kind replaces the
    // older one rather than stacking six duas in the tray.
    tag: payload.tag || payload.category || "surahspot",
    renotify: Boolean(payload.renotify),
    // The icon is the logo tile. The badge is what Android draws in the
    // status bar and beside the app name: a monochrome glyph on transparency,
    // which the platform tints itself. A full-colour icon there renders as a
    // grey blob. iOS ignores both and shows the installed app's own icon.
    icon: "/icon-192.png",
    badge: "/badge-96.png",
    lang: payload.lang || "en",
    dir: payload.dir || "auto",
    timestamp: Date.now(),
    data: { url: payload.url || "/", category: payload.category || "general" },
    silent: Boolean(payload.silent),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

    // Reuse an open tab when there is one, so tapping a notification never
    // leaves the reader with several copies of the app open.
    for (const client of all) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target).catch(() => {});
        return;
      }
    }

    await self.clients.openWindow(target);
  })());
});

/*
 * A subscription can be rotated by the push service. Re-registering keeps
 * notifications working without the reader having to grant permission again.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const applicationServerKey = event.oldSubscription?.options?.applicationServerKey;
    if (!applicationServerKey) return;

    const subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    await fetch("/api/notifications/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription, rotated: true }),
    }).catch(() => {});
  })());
});
