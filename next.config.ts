import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content Security Policy.
 *
 * The app loads no third-party resources at all: no scripts, no frames, no
 * fonts. Recitation audio is proxied through /api/quran/audio and the Quranic
 * face is vendored into public/fonts, so every directive stays on 'self'.
 *
 * 'unsafe-inline' is required for style-src because Next injects inline <style>
 * during hydration, and for script-src only in development, where the dev
 * overlay uses inline and eval'd code.
 */
function contentSecurityPolicy() {
  return [
    "default-src 'self'",
    isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    // No exception needed: the Quranic face is served from this origin.
    // scripts/fetch-font.mjs vendors it and `prebuild` refuses to build
    // without it, so this cannot silently degrade to a system font.
    "font-src 'self' data:",
    // Same-origin only: the browser never talks to Quran Foundation directly,
    // which is what keeps the client credentials server-side.
    isDev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    // The service worker. Without this it falls back to script-src, which in
    // production omits 'unsafe-eval' but also inherits 'unsafe-inline' — being
    // explicit keeps the worker to a same-origin file and nothing else.
    "worker-src 'self'",
    // Production only. Over http://localhost this directive rewrites every
    // /_next/static request to https, where nothing is listening, so the dev
    // server loses all CSS and JS. Safari enforces it on loopback; Chrome
    // exempts loopback, so the breakage is browser-dependent. The same applies
    // to plain-HTTP LAN testing from a phone.
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },

  /*
   * HSTS. Production only: over plain http://localhost it does nothing, and
   * against a self-signed local certificate it pins a rule that is awkward to
   * clear from a browser afterwards.
   *
   * Two years, covering subdomains. `preload` is deliberately absent — it
   * commits the domain to a list baked into browser binaries, which takes
   * months to reverse and would strand any subdomain that ever needs to serve
   * plain HTTP. It is worth doing at hstspreload.org once the domain has
   * settled, as a separate decision rather than a default.
   */
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),

  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Lets the audio element read the proxied stream without opting the whole
  // document into cross-origin isolation, which would break nothing here but
  // is stricter than this app needs.
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

/**
 * The canonical host, derived from the same value that feeds `metadataBase`
 * and the sitemap so the three cannot disagree.
 *
 * Read here rather than imported from lib/config/site so this file stays
 * dependency-free — `next.config.ts` is loaded before the path aliases exist.
 */
function canonicalHost() {
  const configured = (process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL)?.trim();
  if (!configured) return "surahspot.com";
  try {
    return new URL(configured).host;
  } catch {
    return "surahspot.com";
  }
}

/**
 * Hosts that serve the same app but are not the canonical one.
 *
 * Left unredirected they are duplicate content: robots.txt invites indexing
 * and the sitemap names the apex, so a crawler reaching the app on two
 * hostnames splits the ranking between them and may pick the wrong one.
 *
 * Deliberately an explicit list rather than "anything that is not the
 * canonical host". A catch-all would also match the Host header Fly's
 * internal health check arrives with, turning every check into a redirect and
 * the machine into an unhealthy one.
 */
function alternateHosts() {
  const canonical = canonicalHost();
  if (canonical !== "surahspot.com") return [];
  return ["www.surahspot.com", "surahspot.fly.dev"];
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,

  async redirects() {
    const canonical = canonicalHost();

    return alternateHosts().map((host) => ({
      /*
       * Everything except /.well-known.
       *
       * That path carries ACME challenges. Fly answers those at its proxy
       * today, so they never reach this app — but a redirect there would
       * break certificate issuance for the very hostname being redirected,
       * and the failure would look like a DNS problem rather than a config
       * one. Cheap to exclude, expensive to debug.
       */
      source: "/:path((?!\\.well-known/).*)",
      has: [{ type: "host" as const, value: host }],
      destination: `https://${canonical}/:path*`,
      // 308 rather than 302: the move is permanent, and unlike 301 it is
      // guaranteed to preserve the method, so a POST to /api/feedback on the
      // wrong host still arrives as a POST.
      permanent: true,
    }));
  },

  // Produces .next/standalone: a self-contained server with only the packages
  // it actually imports. This is what the Dockerfile copies, and it is why the
  // runtime image does not need node_modules or a package manager.
  output: "standalone",

  eslint: {
    // Lint is a separate CI step. Failing `next build` on a style rule turns a
    // formatting nit into a deploy outage.
    ignoreDuringBuilds: true,
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        // Round payloads contain the answer, so they must never be cached by a
        // browser, proxy, or CDN.
        //
        // Scoped to the game and content endpoints rather than all of /api,
        // because a blanket no-store here also overrode the audio route's own
        // `private, max-age=300` — which meant every seek re-fetched the
        // chapter file from upstream. On a phone that made scrubbing unusable.
        source: "/api/:path(game|quran/round|quran/config|quran/search|quran/translate)*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" },
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
      {
        // The worker is the one file that must never be served stale: a cached
        // copy pins every reader to the old caching rules until it expires,
        // and there is no way to push a fix past it.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/api/health",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
    ];
  },
};

export default nextConfig;
