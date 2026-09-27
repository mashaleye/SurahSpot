/**
 * Quran Foundation's Uthmani text contains Quran-specific combining marks.
 *
 * U+06DF — ARABIC SMALL HIGH ROUNDED ZERO — is valid Quranic Unicode,
 * but the UthmanicHafs font used by SurahSpot can render it as a large,
 * detached dotted circle instead of a small combining annotation.
 *
 * This function is intentionally DISPLAY-ONLY.
 *
 * Do not normalize the Arabic with NFC/NFKC and do not broadly remove
 * Quranic diacritics. We only remove marks that SurahSpot has explicitly
 * decided not to render because of a font/display incompatibility.
 *
 * Every SurahSpot feature that renders Quran Foundation `text_uthmani`
 * should pass its Arabic through this function.
 */
const QURAN_DISPLAY_MARKS_TO_HIDE = /\u06DF/gu;

export function cleanQuranArabicForDisplay(
  input: string | null | undefined,
): string {
  if (!input) return "";

  return input.replace(QURAN_DISPLAY_MARKS_TO_HIDE, "");
}

/**
 * Minimal shape shared by Quran Foundation word responses.
 *
 * Keeping this adapter here means new game modes do not each need to
 * reinvent filtering/sanitizing logic for Quran words.
 */
export type QuranDisplayWordInput = {
  position: number;
  text_uthmani?: string | null;
  char_type_name?: string | null;
};

export type QuranDisplayWord = {
  index: number;
  position: number;
  arabic: string;
};

/**
 * Convert Quran Foundation word objects into SurahSpot-safe display words.
 *
 * Important:
 * - End-of-Ayah metadata is not rendered as a karaoke word.
 * - U+06DF is removed through the central display sanitizer.
 * - A token that becomes completely empty after cleaning is discarded.
 * - Original QF `position` values are preserved so karaoke timing remains
 *   aligned even if a display-only token is omitted.
 */
export function buildQuranDisplayWords(
  input: readonly QuranDisplayWordInput[] | null | undefined,
): QuranDisplayWord[] {
  return (input ?? [])
    .filter(
      (word) =>
        Boolean(word.text_uthmani) &&
        word.char_type_name !== "end",
    )
    .map((word) => ({
      position: word.position,
      arabic: cleanQuranArabicForDisplay(word.text_uthmani),
    }))
    .filter((word) => word.arabic.trim().length > 0)
    .map((word, index) => ({
      index,
      position: word.position,
      arabic: word.arabic,
    }));
}

/**
 * Build a safe complete-Ayah display string.
 *
 * Prefer QF's complete Uthmani text when available. The sanitized word list is
 * the fallback for responses where a complete verse string is missing.
 */
export function buildQuranDisplayVerseText(
  textUthmani: string | null | undefined,
  words: readonly QuranDisplayWord[],
): string {
  const source =
    textUthmani ??
    words.map((word) => word.arabic).join(" ");

  return cleanQuranArabicForDisplay(source);
}

/**
 * Strip Quran Foundation's inline markup from translation and transliteration
 * text before it is rendered.
 *
 * The text goes into React as a string, so this is not an XSS boundary — React
 * escapes it either way. It is a presentation fix: QF returns footnote markers,
 * <sup> references and <br> tags inline, which render as literal noise.
 *
 * Tags are replaced with a space rather than removed. Removing them fused
 * adjacent spans together, so "the Cow" arrived as "theCow" whenever the
 * resource wrapped a word in markup.
 */
export function cleanTranslationHtml(input: string) {
  if (!input) return "";
  return input
    // Footnote superscripts carry no meaning once the footnote itself is gone.
    .replace(/<sup[^>]*>.*?<\/sup>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize a Surah search term for local matching.
 *
 * Shared with the client so "Al-Baqarah", "al baqarah", "Baqarah" and
 * "surah baqarah" all reach the same entry whether the match happens in the
 * browser or against the local catalog on the server.
 */
export function normalizeSurahQuery(value: string | null | undefined) {
  // Catalog fields are optional upstream: a chapter record with no
  // name_complex used to crash local search with a TypeError, which the route
  // then reported as a 500 for every fallback query.
  if (!value) return "";
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^surah\s+/, "")
    .replace(/[\u2019'`._-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
