import { siteOrigin } from "@/lib/config/site";
import { SURAH_FACTS } from "@/lib/quran/surah-facts";
import {
  INCLUDE_SURAH_PAGES_IN_SITEMAP,
  SITE_PAGES,
  surahSitemapEntries,
} from "@/lib/site/pages";

/**
 * The machine-readable sitemap.
 *
 * Written as a route handler rather than Next's `app/sitemap.ts` metadata
 * convention, because that convention reserves the `/sitemap` path itself —
 * which is where the readable version lives. Emitting the XML here frees it.
 *
 * Kept as plain XML on purpose. The usual way to make one pretty is an
 * `xml-stylesheet` processing instruction pointing at an XSL file, but Chrome
 * removes XSLT in version 158 on 17 November 2026, so that would look right
 * for a few weeks and then revert to raw markup for most visitors. /sitemap is
 * an ordinary page instead, and will still render in ten years.
 */

/** Escaped even though every URL here is ours: one stray `&` invalidates the file. */
function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const origin = siteOrigin();
  // Date only. A full timestamp would change on every request and tell a
  // crawler the page changed when nothing did.
  const lastModified = new Date().toISOString().slice(0, 10);

  /*
   * The Surah pages are gated behind a flag, not absent. See
   * INCLUDE_SURAH_PAGES_IN_SITEMAP for why they are held back on a new domain
   * and what evidence should switch them on.
   */
  const pages = INCLUDE_SURAH_PAGES_IN_SITEMAP
    ? [...SITE_PAGES, ...surahSitemapEntries(SURAH_FACTS)]
    : SITE_PAGES;

  const urls = pages.map((page) => [
    "  <url>",
    `    <loc>${xmlEscape(`${origin}${page.path}`)}</loc>`,
    `    <lastmod>${lastModified}</lastmod>`,
    `    <changefreq>${page.changeFrequency}</changefreq>`,
    `    <priority>${page.priority}</priority>`,
    "  </url>",
  ].join("\n")).join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
