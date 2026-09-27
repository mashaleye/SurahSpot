export const LEARNING_MUSHAF_ID = 1; // Quran Foundation QCF V2 / standard 604-page Madani layout.
export const LEARNING_TOTAL_PAGES = 604;

export type LearningLayoutMode = "book" | "scroll";
export type LearningDisplayMode = "arabic" | "verse-translation" | "translation";

export type LearningChapter = {
  id: number;
  nameSimple: string;
  nameArabic: string;
  translatedName: string;
  versesCount: number;
};

export type LearningVerse = {
  chapterId: number;
  verseNumber: number;
  verseKey: string;
  pageNumber: number;
  juzNumber: number;
  hizbNumber: number;
  arabic: string;
  translation: string;
};

export type LearningPageData = {
  pageNumber: number;
  totalPages: number;
  juzNumbers: number[];
  hizbNumbers: number[];
  chapters: LearningChapter[];
  verses: LearningVerse[];
  translationMeta: {
    language: string;
    resourceId: number;
    name: string;
    author: string;
  };
};

export type LearningSurahData = {
  chapter: LearningChapter;
  pages: number[];
  juzNumbers: number[];
  hizbNumbers: number[];
  verses: LearningVerse[];
  translationMeta: LearningPageData["translationMeta"];
};

export type LearningLanguage = {
  id: string;
  label: string;
  available: boolean;
  resourceId?: number;
  resourceName?: string;
  author?: string;
};

export type LearningConfig = {
  totalPages: number;
  languages: LearningLanguage[];
  chapters: LearningChapter[];
};

export type ParsedAyahRange = {
  start: number;
  end: number;
};

/**
 * Parse an accessible Ayah range such as "7-12", "1 - 10", or "7,12".
 * Both western and Arabic commas are accepted so the same range field works
 * naturally with English and Arabic mobile keyboards.
 * The typed range is intentionally not limited to the 5–10 gesture size:
 * keyboard/switch users may hide any valid range inside the active Surah.
 */
export function parseAyahRange(input: string, maxAyah: number): ParsedAyahRange | null {
  const match = input.trim().match(/^(\d{1,3})\s*[-–—,،]\s*(\d{1,3})$/);
  if (!match) return null;

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 1 || end < start || end > maxAyah) return null;
  return { start, end };
}

export function formatNumberSpan(values: readonly number[]) {
  const unique = Array.from(new Set(values)).sort((a, b) => a - b);
  if (!unique.length) return "—";
  if (unique.length === 1) return String(unique[0]);
  return `${unique[0]}–${unique[unique.length - 1]}`;
}
