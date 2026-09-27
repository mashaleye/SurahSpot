import type { Metadata } from "next";
import Link from "next/link";

import { SitePage } from "@/components/site/SitePage";
import { SITE_PAGES, SITE_SECTIONS, pagesInSection } from "@/lib/site/pages";

export const metadata: Metadata = {
  alternates: { canonical: "/sitemap" },
  title: "Sitemap — SurahSpot",
  description: "Every page on SurahSpot, grouped by what it is for.",
};

/**
 * The readable sitemap.
 *
 * A separate page rather than a stylesheet over /sitemap.xml. The classic
 * approach — an `xml-stylesheet` processing instruction pointing at an XSL
 * file — stops working in Chrome 158 on 17 November 2026, when XSLT is
 * removed. This renders as ordinary HTML and will not expire.
 *
 * /sitemap.xml is untouched and still what crawlers read; robots.txt still
 * points there.
 */
export default function SitemapPage() {
  return (
    <SitePage>
      <section className="content-section sitemap-section" aria-labelledby="sitemap-title">
        <header className="sitemap-head">
          <p className="eyebrow">SITEMAP</p>
          <h1 id="sitemap-title">
            Everything here,
            <br />
            <em>in one place.</em>
          </h1>
          <p className="sitemap-lede">
            {SITE_PAGES.length} pages. Whichever you are after, it is one click from here.
          </p>
        </header>

        <div className="sitemap-groups">
          {SITE_SECTIONS.map((section) => (
            <section className="sitemap-group" key={section} aria-labelledby={`sitemap-${section}`}>
              <h2 id={`sitemap-${section}`}>{section}</h2>

              <ul>
                {pagesInSection(section).map((page) => (
                  <li key={page.path}>
                    <Link href={page.path}>
                      <span className="sitemap-entry-title">{page.title}</span>
                      <span className="sitemap-entry-summary">{page.summary}</span>
                      <span className="sitemap-entry-path">{page.path}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="sitemap-foot">
          <p>
            Crawlers want the machine-readable version, which lives at{" "}
            <a href="/sitemap.xml">/sitemap.xml</a>.
          </p>
        </footer>
      </section>
    </SitePage>
  );
}
