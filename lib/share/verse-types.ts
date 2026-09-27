export type ShareVersePayload = {
  version: 1;
  chapterId: number;
  verseNumber: number;
  language: string;
  translationId: number;
  createdAt: number;
};

export type SharedVerseData = ShareVersePayload & {
  nameSimple: string;
  nameArabic: string;
  translatedName: string;
  arabic: string;
  translation: string;
  translationName: string;
  translationAuthor: string;
};

export function isShareVersePayload(value: unknown): value is ShareVersePayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ShareVersePayload>;
  return Boolean(
    item.version === 1 &&
    Number.isInteger(item.chapterId) && (item.chapterId ?? 0) >= 1 && (item.chapterId ?? 115) <= 114 &&
    Number.isInteger(item.verseNumber) && (item.verseNumber ?? 0) >= 1 &&
    typeof item.language === "string" && item.language.length > 0 && item.language.length <= 80 &&
    Number.isInteger(item.translationId) && (item.translationId ?? 0) > 0 &&
    Number.isFinite(item.createdAt) && (item.createdAt ?? 0) > 0
  );
}
