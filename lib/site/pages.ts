/**
 * Every public page, once.
 *
 * Two things read this: the XML sitemap crawlers fetch, and the readable
 * sitemap people land on. Keeping them on one list means a page added to the
 * site cannot appear in one and not the other — which is the usual way a
 * sitemap goes quietly out of date.
 */

export type SitePageEntry = {
  path: string;
  title: string;
  /** One line, shown on the readable sitemap. Not used by the XML. */
  summary: string;
  /** Grouping for the readable sitemap only. */
  section: "Practice" | "Read" | "Reference" | "Legal";
  changeFrequency: "weekly" | "monthly";
  priority: number;
};

export const SITE_PAGES: readonly SitePageEntry[] = [
  {
    path: "/",
    title: "Play",
    summary: "Listen to an Ayah, follow the recitation, and name the Surah it comes from.",
    section: "Practice",
    changeFrequency: "weekly",
    priority: 1,
  },
  {
    path: "/learning-blocks",
    title: "Learning Blocks",
    summary: "Read the Qur'an page by page, hide Ayahs for recall practice, and rebuild them in sequence.",
    section: "Read",
    changeFrequency: "weekly",
    priority: 0.85,
  },
  {
    path: "/how-it-works",
    title: "How it works",
    summary: "Scoring, tries, hints, and what each mode asks of you.",
    section: "Practice",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    path: "/surahs",
    title: "Popular Surahs",
    summary: "Frequently revisited chapters, each opening straight into the reader.",
    section: "Read",
    changeFrequency: "monthly",
    priority: 0.75,
  },
  {
    path: "/names-of-allah",
    title: "99 Names of Allah",
    summary: "The Asma-ul-Husna, with meanings and transliteration.",
    section: "Reference",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/dhikr-duas",
    title: "Dhikr & Duas",
    summary: "Short remembrances and supplications for the rhythm of the day.",
    section: "Reference",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/privacy",
    title: "Privacy",
    summary: "What is stored, what is sent elsewhere, and what never leaves your device.",
    section: "Legal",
    changeFrequency: "monthly",
    priority: 0.3,
  },
  {
    path: "/terms",
    title: "Terms",
    summary: "Using SurahSpot, and where its Qur'an content comes from.",
    section: "Legal",
    changeFrequency: "monthly",
    priority: 0.3,
  },
];

export const SITE_SECTIONS = ["Practice", "Read", "Reference", "Legal"] as const;

export function pagesInSection(section: SitePageEntry["section"]) {
  return SITE_PAGES.filter((page) => page.section === section);
}

/* =========================================================
   The 114 Surah pages
   ========================================================= */

/**
 * Whether /sitemap.xml also lists a URL for every Surah.
 *
 * This was `false` on the theory that submitting 122 URLs instead of 8 would
 * hold a new domain back. That is not a real Google mechanism — see
 * docs/SITE-INTEGRATION.md, which keeps the full correction. In short: Google's
 * crawl-budget guidance starts at 10,000+ pages, its sitemap guidance is to
 * include everything you want crawled, and withholding these pages only delays
 * discovery while forfeiting the Page Indexing report that would tell you
 * whether they are considered substantial enough to index.
 *
 * Kept as a flag rather than removed because it is genuinely useful for staging
 * the pages out of the sitemap while the template is still changing. It is a
 * constant rather than an environment variable on purpose: this file is read
 * during a static build, so an env var would only appear to be settable at
 * runtime — the trap that already caught SITE_URL, which is why that one is a
 * Docker build arg.
 */
export const INCLUDE_SURAH_PAGES_IN_SITEMAP = true;

/**
 * Sitemap entries for the Surah pages.
 *
 * Lower priority than the pages that lead somewhere: these are leaves, and
 * every one of them exists to hand the reader on to Learning Blocks. Monthly
 * rather than weekly because their content is structural — an Ayah count does
 * not change.
 */
export function surahSitemapEntries(
  surahs: ReadonlyArray<{ slug: string; nameSimple: string; versesCount: number }>,
): SitePageEntry[] {
  return surahs.map((surah) => ({
    path: `/surah/${surah.slug}`,
    title: `Surah ${surah.nameSimple}`,
    summary: `Ayah count, revelation place and Juz for Surah ${surah.nameSimple}.`,
    section: "Read" as const,
    changeFrequency: "monthly" as const,
    priority: 0.5,
  }));
}
