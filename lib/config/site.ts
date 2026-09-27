/**
 * The public origin this deployment is served from.
 *
 * One source of truth, because two things depend on getting it right and both
 * fail quietly when it is wrong:
 *
 *   - The sitemap, which lists absolute URLs.
 *   - `metadataBase`, which is how Next turns the generated Open Graph images
 *     into absolute URLs. Without it, Next falls back to
 *     `http://localhost:3000` — and since that only shows up in a meta tag,
 *     nothing breaks visibly. The share card simply never renders for anyone
 *     who receives the link.
 *
 * Set `SITE_URL` when the app is served from anywhere other than
 * surahspot.com — a preview deployment, a tunnel, a staging host.
 *
 * This is read at **build time**, not runtime. Most pages here are statically
 * prerendered, so `metadataBase` and `sitemap()` are both evaluated during
 * `next build`; setting the variable on a running container looks like it
 * works and changes nothing. The Dockerfile takes it as a build argument for
 * that reason.
 *
 * NEXT_PUBLIC_SITE_URL is still honoured, for a deployment already passing
 * that name.
 */
const FALLBACK_ORIGIN = "https://surahspot.com";

export function siteOrigin(): string {
  const configured = (process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL)?.trim();
  if (!configured) return FALLBACK_ORIGIN;

  try {
    // Parsed rather than trusted: a malformed value here would throw inside
    // `metadataBase` and take every page down, which is a poor trade for a
    // typo in an environment variable.
    const url = new URL(configured);
    return url.origin;
  } catch {
    return FALLBACK_ORIGIN;
  }
}

export function siteUrl(): URL {
  return new URL(siteOrigin());
}
