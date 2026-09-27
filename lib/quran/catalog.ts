import { languageMatches, REQUESTED_LANGUAGES } from "./languages";
import { qfFetch } from "./client";
import { CANONICAL_CHAPTERS } from "./chapters";
import { normalizeSurahQuery } from "./text";

export type Chapter = {
  id: number;
  revelation_place: string;
  revelation_order: number;
  bismillah_pre: boolean;
  name_simple: string;
  name_complex: string;
  name_arabic: string;
  verses_count: number;
  translated_name?: { language_name: string; name: string };
};

export type TranslationResource = {
  id: number;
  name: string;
  author_name: string;
  slug: string;
  language_name: string;
};

export type ChapterReciter = {
  id: number;
  name: string;
  style?: { name?: string | null; language_name?: string };
  qirat?: { name?: string | null; language_name?: string };
};


/**
 * Pad an upstream chapter list up to the canonical 114.
 *
 * The Quran Foundation /chapters endpoint normally returns all of them, but the
 * game must never become unplayable because a pre-live response, a proxy, a
 * cache, or the mock upstream came back short. API metadata is still preferred
 * wherever it exists — the local table only fills gaps.
 */
function completeChapterCatalog(chapters: Chapter[]) {
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));

  return CANONICAL_CHAPTERS.map(([id, nameSimple, nameArabic, versesCount]) => {
    const upstream = byId.get(id);
    if (upstream) return upstream;

    return {
      id,
      revelation_place: "",
      revelation_order: 0,
      bismillah_pre: id !== 9,
      name_simple: nameSimple,
      name_complex: nameSimple,
      name_arabic: nameArabic,
      verses_count: versesCount,
      translated_name: undefined,
    } satisfies Chapter;
  });
}

export type Catalog = {
  fetchedAt: number;
  expires: number;
  chapters: Chapter[];
  // Chapter ids the environment actually serves. The canonical 114 are padded
  // in so the answer picker stays complete, but a Surah upstream does not have
  // cannot build a round.
  upstreamChapterIds: Set<number>;
  translations: TranslationResource[];
  reciters: ChapterReciter[];
};

type CatalogGlobals = typeof globalThis & {
  __surahspotCatalog?: Catalog | null;
  __surahspotCatalogInflight?: Promise<Catalog> | null;
};

const catalogGlobals = globalThis as CatalogGlobals;

const CATALOG_TTL_MS = 15 * 60_000;
// How long an expired catalog may still be served if a refresh fails. Chapter
// names, reciters and translation resources change on the order of months, so
// a stale catalog is enormously better than a dead app during an upstream blip.
const CATALOG_STALE_GRACE_MS = 6 * 60 * 60_000;

async function fetchCatalog(): Promise<Catalog> {
  const [chaptersData, translationsData, recitersData] = await Promise.all([
    qfFetch<{ chapters: Chapter[] }>("/chapters?language=en"),
    qfFetch<{ translations: TranslationResource[] }>("/resources/translations?language=en"),
    qfFetch<{ reciters: ChapterReciter[] }>("/resources/chapter_reciters?language=en"),
  ]);

  const now = Date.now();
  return {
    fetchedAt: now,
    expires: now + CATALOG_TTL_MS,
    chapters: completeChapterCatalog(chaptersData.chapters ?? []),
    upstreamChapterIds: new Set(
      (chaptersData.chapters ?? [])
        .map((chapter) => Number(chapter?.id))
        .filter((id) => Number.isInteger(id) && id >= 1 && id <= 114),
    ),
    translations: translationsData.translations ?? [],
    reciters: recitersData.reciters ?? [],
  };
}

/**
 * Chapters, translation resources and chapter reciters, cached per process.
 *
 * Three behaviours matter in production and none of them were here before:
 *
 * - Concurrent callers share one refresh. A cold start under load previously
 *   issued three upstream calls per in-flight request.
 * - A failed refresh falls back to the last good catalog for a grace period,
 *   so a brief upstream outage degrades rather than breaks the game.
 * - The cache hangs off globalThis so a dev-server hot reload does not discard
 *   it and re-fetch on the next keystroke.
 */
export async function getCatalog(): Promise<Catalog> {
  const cached = catalogGlobals.__surahspotCatalog;
  if (cached && cached.expires > Date.now()) return cached;

  const inflight = catalogGlobals.__surahspotCatalogInflight;
  if (inflight) return inflight;

  const pending = fetchCatalog()
    .then((catalog) => {
      catalogGlobals.__surahspotCatalog = catalog;
      return catalog;
    })
    .catch((error) => {
      const stale = catalogGlobals.__surahspotCatalog;
      if (stale && Date.now() - stale.fetchedAt < CATALOG_STALE_GRACE_MS) {
        console.warn("[catalog] refresh failed, serving stale catalog", error);
        // Back off before the next attempt so a hard outage is not hammered.
        stale.expires = Date.now() + 60_000;
        return stale;
      }
      throw error;
    })
    .finally(() => { catalogGlobals.__surahspotCatalogInflight = null; });

  catalogGlobals.__surahspotCatalogInflight = pending;
  return pending;
}

/** Test seam: drop the cached catalog. */
export function resetCatalogCache() {
  catalogGlobals.__surahspotCatalog = null;
  catalogGlobals.__surahspotCatalogInflight = null;
}

export function chooseTranslation(translations: TranslationResource[], language: string) {
  const matches = translations.filter((translation) => languageMatches(language, translation.language_name));
  if (!matches.length) return null;
  if (language === "english") {
    return matches.find((item) => item.id === 131) ?? matches.find((item) => /clear quran/i.test(item.name)) ?? matches[0];
  }
  return matches[0];
}

export function chooseReciter(reciters: ChapterReciter[], preferredId?: number) {
  if (preferredId) {
    const selected = reciters.find((reciter) => reciter.id === preferredId);
    if (selected) return selected;
  }
  return reciters.find((reciter) => /afasy|alafasy/i.test(reciter.name)) ?? reciters[0];
}

export function languageCatalog(translations: TranslationResource[]) {
  return REQUESTED_LANGUAGES.map((language) => {
    const resource = chooseTranslation(translations, language);
    return {
      id: language,
      label: language,
      available: Boolean(resource),
      translationId: resource?.id ?? null,
      translationName: resource?.name ?? null,
      authorName: resource?.author_name ?? null,
    };
  });
}

/** Lookup by chapter id. Used by every route that resolves a sealed answer. */
export function findChapter(catalog: Catalog, chapterId: number) {
  return catalog.chapters.find((chapter) => chapter.id === chapterId) ?? null;
}

/**
 * Offline Surah matching against the canonical catalog.
 *
 * The search route calls Quran Foundation Quick Search first, but that is a
 * network dependency sitting in front of the one control a player must always
 * have: choosing an answer. If Search is down, or rate-limited, or the `search`
 * scope was never granted, this keeps the answer picker fully usable.
 */
export function searchChaptersLocally(catalog: Catalog, query: string, limit = 25) {
  const normalized = normalizeSurahQuery(query);
  if (!normalized) return [];

  const scored = catalog.chapters.flatMap((chapter) => {
    const aliases = [
      chapter.name_simple,
      chapter.name_complex,
      chapter.translated_name?.name ?? "",
      String(chapter.id),
    ].map(normalizeSurahQuery);

    // Arabic is compared unnormalized: the Latin-oriented normalizer strips
    // the diacritics that distinguish Arabic Surah names from one another.
    const arabicMatch = chapter.name_arabic?.includes(query.trim());

    let score = -1;
    for (const alias of aliases) {
      if (!alias) continue;
      if (alias === normalized) { score = Math.max(score, 3); continue; }
      if (alias.startsWith(normalized)) { score = Math.max(score, 2); continue; }
      if (alias.includes(normalized)) score = Math.max(score, 1);
    }
    if (arabicMatch) score = Math.max(score, 2);

    return score >= 0 ? [{ chapter, score }] : [];
  });

  return scored
    .sort((a, b) => b.score - a.score || a.chapter.id - b.chapter.id)
    .slice(0, limit)
    .map((entry) => entry.chapter);
}
