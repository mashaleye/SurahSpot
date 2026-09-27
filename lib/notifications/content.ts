import { notFound, upstreamError } from "@/lib/http/api-error";
import { chooseTranslation, findChapter, getCatalog } from "@/lib/quran/catalog";
import { qfFetch } from "@/lib/quran/client";
import { cleanQuranArabicForDisplay, cleanTranslationHtml } from "@/lib/quran/text";
import { getStore } from "@/lib/store";

/**
 * What each notification says.
 *
 * Scripture is never written out in this file. The lists below hold only
 * references; the words themselves are resolved at send time through the same
 * Quran Foundation pipeline and the same vetted translation resource the
 * reader sees in the app. That keeps one source of truth for sacred text and
 * means a notification can never quote something the app would not.
 */

export type VerseRef = { chapterId: number; verseNumber: number };

/**
 * Verses for the daily verse notification. Chosen for being widely known and
 * self-contained enough to stand alone in a one-line notification.
 */
export const VERSE_OF_THE_DAY: VerseRef[] = [
  { chapterId: 1, verseNumber: 5 },
  { chapterId: 2, verseNumber: 152 },
  { chapterId: 2, verseNumber: 153 },
  { chapterId: 2, verseNumber: 186 },
  { chapterId: 2, verseNumber: 255 },
  { chapterId: 2, verseNumber: 286 },
  { chapterId: 3, verseNumber: 139 },
  { chapterId: 3, verseNumber: 159 },
  { chapterId: 6, verseNumber: 162 },
  { chapterId: 8, verseNumber: 46 },
  { chapterId: 9, verseNumber: 40 },
  { chapterId: 13, verseNumber: 11 },
  { chapterId: 13, verseNumber: 28 },
  { chapterId: 14, verseNumber: 7 },
  { chapterId: 15, verseNumber: 9 },
  { chapterId: 16, verseNumber: 97 },
  { chapterId: 17, verseNumber: 82 },
  { chapterId: 20, verseNumber: 114 },
  { chapterId: 21, verseNumber: 107 },
  { chapterId: 24, verseNumber: 35 },
  { chapterId: 29, verseNumber: 69 },
  { chapterId: 33, verseNumber: 41 },
  { chapterId: 39, verseNumber: 53 },
  { chapterId: 40, verseNumber: 60 },
  { chapterId: 41, verseNumber: 33 },
  { chapterId: 49, verseNumber: 13 },
  { chapterId: 55, verseNumber: 13 },
  { chapterId: 57, verseNumber: 4 },
  { chapterId: 64, verseNumber: 11 },
  { chapterId: 65, verseNumber: 3 },
  { chapterId: 93, verseNumber: 5 },
  { chapterId: 94, verseNumber: 6 },
  { chapterId: 103, verseNumber: 3 },
];

/**
 * Duas drawn from the Qur'an itself, so the same resolver serves them and the
 * wording carries the same provenance as everything else in the app.
 */
export const QURANIC_DUAS: VerseRef[] = [
  { chapterId: 1, verseNumber: 6 },
  { chapterId: 2, verseNumber: 127 },
  { chapterId: 2, verseNumber: 201 },
  { chapterId: 2, verseNumber: 250 },
  { chapterId: 2, verseNumber: 286 },
  { chapterId: 3, verseNumber: 8 },
  { chapterId: 3, verseNumber: 16 },
  { chapterId: 3, verseNumber: 147 },
  { chapterId: 3, verseNumber: 173 },
  { chapterId: 3, verseNumber: 193 },
  { chapterId: 7, verseNumber: 23 },
  { chapterId: 7, verseNumber: 126 },
  { chapterId: 10, verseNumber: 85 },
  { chapterId: 14, verseNumber: 40 },
  { chapterId: 17, verseNumber: 24 },
  { chapterId: 17, verseNumber: 80 },
  { chapterId: 18, verseNumber: 10 },
  { chapterId: 20, verseNumber: 25 },
  { chapterId: 20, verseNumber: 114 },
  { chapterId: 21, verseNumber: 87 },
  { chapterId: 21, verseNumber: 89 },
  { chapterId: 23, verseNumber: 109 },
  { chapterId: 25, verseNumber: 74 },
  { chapterId: 26, verseNumber: 83 },
  { chapterId: 28, verseNumber: 24 },
  { chapterId: 40, verseNumber: 7 },
  { chapterId: 46, verseNumber: 15 },
  { chapterId: 59, verseNumber: 10 },
  { chapterId: 60, verseNumber: 5 },
  { chapterId: 66, verseNumber: 8 },
];

/** Short Surahs the recitation nudge rotates through. */
export const RECITATION_SUGGESTIONS: number[] = [
  36, 55, 56, 67, 78, 87, 91, 93, 94, 97, 103, 108, 109, 110, 112, 113, 114,
];

export type ResolvedVerse = {
  chapterId: number;
  verseNumber: number;
  verseKey: string;
  chapterName: string;
  arabic: string;
  translation: string;
};

/**
 * Resolved verses are cached for a day.
 *
 * A dispatch touches at most a handful of distinct references but may fan out
 * to thousands of subscribers, so without this the upstream would see one
 * request per subscriber for the same Ayah.
 */
const RESOLVED_TTL_MS = 24 * 60 * 60_000;

function resolvedKey(ref: VerseRef, language: string) {
  return `notif:verse:${ref.chapterId}:${ref.verseNumber}:${language}`;
}

type ApiVerse = {
  chapter_id: number;
  verse_number: number;
  verse_key: string;
  text_uthmani?: string;
  translations?: Array<{ resource_id: number; text: string }>;
};

function versePath(ref: VerseRef, translationId: number) {
  const params = new URLSearchParams({
    page: String(ref.verseNumber),
    per_page: "1",
    words: "false",
    fields: "chapter_id,text_uthmani",
    translations: String(translationId),
    translation_fields: "resource_name,language_name",
  });
  return `/verses/by_chapter/${ref.chapterId}?${params.toString()}`;
}

export async function resolveVerse(ref: VerseRef, language = "english"): Promise<ResolvedVerse> {
  const store = getStore();
  const cacheKey = resolvedKey(ref, language);

  const cached = await store.get<ResolvedVerse>(cacheKey);
  if (cached) return cached;

  const catalog = await getCatalog();
  const chapter = findChapter(catalog, ref.chapterId);
  if (!chapter) throw notFound(`Surah ${ref.chapterId} is not in the catalog.`);

  const translation = chooseTranslation(catalog.translations, language)
    ?? chooseTranslation(catalog.translations, "english");
  if (!translation) throw notFound("No translation resource is available right now.");

  const response = await qfFetch<{ verses: ApiVerse[] }>(versePath(ref, translation.id));
  const verse = response.verses?.[0];

  if (!verse || verse.chapter_id !== ref.chapterId || verse.verse_number !== ref.verseNumber) {
    throw upstreamError(
      `Quran Foundation returned an unexpected Ayah for ${ref.chapterId}:${ref.verseNumber}.`,
    );
  }

  const resolved: ResolvedVerse = {
    chapterId: verse.chapter_id,
    verseNumber: verse.verse_number,
    verseKey: verse.verse_key,
    chapterName: chapter.name_simple,
    arabic: cleanQuranArabicForDisplay(verse.text_uthmani),
    translation: cleanTranslationHtml(
      verse.translations?.find((item) => item.resource_id === translation.id)?.text ?? "",
    ),
  };

  await store.set(cacheKey, resolved, RESOLVED_TTL_MS);
  return resolved;
}

/** Trim a translation to something that survives a notification tray. */
export function condense(text: string, maxLength = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLength) return flat;
  const cut = flat.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export type NotificationContent = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

export function streakContent(streak: number): NotificationContent {
  return {
    title: streak === 1 ? "Keep your streak going" : `Your ${streak}-day streak is waiting`,
    body: "A few Ayahs today is enough to keep it alive.",
    url: "/learning-blocks",
    tag: "streak",
  };
}

export function recitationContent(chapterName: string, chapterId: number): NotificationContent {
  return {
    title: "Time to listen",
    body: `Sit with Surah ${chapterName} for a few minutes.`,
    url: `/learning-blocks?chapter=${chapterId}`,
    tag: "recitation",
  };
}

export function verseContent(verse: ResolvedVerse): NotificationContent {
  return {
    title: `${verse.chapterName} ${verse.verseNumber}`,
    body: condense(verse.translation),
    url: `/learning-blocks?chapter=${verse.chapterId}&verse=${verse.verseNumber}`,
    tag: "verse",
  };
}

export function duaContent(verse: ResolvedVerse): NotificationContent {
  return {
    title: "A dua for now",
    body: condense(verse.translation),
    url: `/learning-blocks?chapter=${verse.chapterId}&verse=${verse.verseNumber}`,
    tag: "dua",
  };
}
