import "server-only";

import { findChapter, getCatalog } from "@/lib/quran/catalog";
import { qfFetch } from "@/lib/quran/client";
import { buildQuranDisplayVerseText, buildQuranDisplayWords, cleanTranslationHtml } from "@/lib/quran/text";
import type { SharedVerseData, ShareVersePayload } from "./verse-types";

type ApiWord = { position: number; text_uthmani?: string; char_type_name?: string };
type ApiVerse = {
  chapter_id: number;
  verse_number: number;
  text_uthmani?: string;
  words?: ApiWord[];
  translations?: Array<{ resource_id: number; text: string }>;
};

export async function loadSharedVerse(payload: ShareVersePayload): Promise<SharedVerseData> {
  const catalog = await getCatalog();
  const chapter = findChapter(catalog, payload.chapterId);
  if (!chapter) throw new Error("Could not resolve this Surah.");
  const translation = catalog.translations.find((item) => item.id === payload.translationId);
  if (!translation) throw new Error("This translation resource is no longer available.");

  const query = new URLSearchParams({
    page: String(payload.verseNumber),
    per_page: "1",
    words: "true",
    fields: "chapter_id,text_uthmani",
    word_fields: "text_uthmani,location",
    translations: String(translation.id),
    translation_fields: "resource_name,language_name",
  });
  const data = await qfFetch<{ verses: ApiVerse[] }>(`/verses/by_chapter/${payload.chapterId}?${query.toString()}`);
  const verse = data.verses?.[0];
  if (!verse || verse.verse_number !== payload.verseNumber) throw new Error("The shared Ayah is unavailable right now.");

  const words = buildQuranDisplayWords(verse.words);
  const translated = verse.translations?.find((item) => item.resource_id === translation.id)?.text ?? "";
  return {
    ...payload,
    nameSimple: chapter.name_simple,
    nameArabic: chapter.name_arabic,
    translatedName: chapter.translated_name?.name ?? "",
    arabic: buildQuranDisplayVerseText(verse.text_uthmani, words),
    translation: cleanTranslationHtml(translated),
    translationName: translation.name,
    translationAuthor: translation.author_name,
  };
}
