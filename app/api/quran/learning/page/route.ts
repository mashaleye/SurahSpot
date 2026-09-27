import type { NextRequest } from "next/server";
import { chooseTranslation, findChapter, getCatalog } from "@/lib/quran/catalog";
import { qfFetch } from "@/lib/quran/client";
import { badRequest, notFound, toErrorResponse, upstreamError } from "@/lib/http/api-error";
import { jsonWithValidator } from "@/lib/http/conditional";
import { LEARNING_MUSHAF_ID, LEARNING_TOTAL_PAGES, type LearningPageData } from "@/lib/learning/types";
import { cleanQuranArabicForDisplay, cleanTranslationHtml } from "@/lib/quran/text";

export const dynamic = "force-dynamic";
const ROUTE = "api/quran/learning/page";
const CACHE_TTL_MS = 30 * 60_000;
const MAX_CACHE_ENTRIES = 96;

type ApiVerse = {
  chapter_id: number;
  verse_number: number;
  verse_key: string;
  page_number: number;
  juz_number: number;
  hizb_number: number;
  text_uthmani?: string;
  translations?: Array<{ resource_id: number; text: string }>;
};

type CachedPage = { expiresAt: number; data: LearningPageData };
const cache = new Map<string, CachedPage>();

function remember(key: string, data: LearningPageData) {
  cache.delete(key);
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export async function GET(request: NextRequest) {
  try {
    const pageNumber = Number(request.nextUrl.searchParams.get("page") ?? "1");
    const language = String(request.nextUrl.searchParams.get("language") ?? "english").trim().toLowerCase();
    const ifNoneMatch = request.headers.get("if-none-match");
    const acceptEncoding = request.headers.get("accept-encoding");
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > LEARNING_TOTAL_PAGES) {
      throw badRequest(`Page must be between 1 and ${LEARNING_TOTAL_PAGES}.`);
    }

    const catalog = await getCatalog();
    const translation = chooseTranslation(catalog.translations, language)
      ?? chooseTranslation(catalog.translations, "english");
    if (!translation) throw notFound("No translation resource is available right now.");

    const cacheKey = `${pageNumber}:${translation.id}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      cache.delete(cacheKey);
      cache.set(cacheKey, cached);
      return jsonWithValidator(cached.data, ifNoneMatch, { acceptEncoding });
    }

    const params = new URLSearchParams({
      language: "en",
      mushaf: String(LEARNING_MUSHAF_ID),
      words: "false",
      per_page: "50",
      fields: "chapter_id,text_uthmani",
      translations: String(translation.id),
      translation_fields: "resource_name,language_name",
    });
    const result = await qfFetch<{ verses: ApiVerse[] }>(
      `/verses/by_page/${pageNumber}?${params.toString()}`,
    );
    const apiVerses = result.verses ?? [];
    if (!apiVerses.length) throw upstreamError(`Quran Foundation returned no Ayahs for page ${pageNumber}.`);

    const chapterIds = Array.from(new Set(apiVerses.map((verse) => verse.chapter_id)));
    const chapters = chapterIds.map((id) => {
      const chapter = findChapter(catalog, id);
      if (!chapter) throw upstreamError(`Could not resolve Surah ${id} for page ${pageNumber}.`);
      return {
        id: chapter.id,
        nameSimple: chapter.name_simple,
        nameArabic: chapter.name_arabic,
        translatedName: chapter.translated_name?.name ?? "",
        versesCount: chapter.verses_count,
      };
    });

    const data: LearningPageData = {
      pageNumber,
      totalPages: LEARNING_TOTAL_PAGES,
      juzNumbers: Array.from(new Set(apiVerses.map((verse) => verse.juz_number).filter(Number.isFinite))),
      hizbNumbers: Array.from(new Set(apiVerses.map((verse) => verse.hizb_number).filter(Number.isFinite))),
      chapters,
      verses: apiVerses.map((verse) => ({
        chapterId: verse.chapter_id,
        verseNumber: verse.verse_number,
        verseKey: verse.verse_key,
        pageNumber: verse.page_number || pageNumber,
        juzNumber: verse.juz_number,
        hizbNumber: verse.hizb_number,
        arabic: cleanQuranArabicForDisplay(verse.text_uthmani),
        translation: cleanTranslationHtml(
          verse.translations?.find((item) => item.resource_id === translation.id)?.text ?? "",
        ),
      })),
      translationMeta: {
        language,
        resourceId: translation.id,
        name: translation.name,
        author: translation.author_name,
      },
    };

    remember(cacheKey, data);
    return jsonWithValidator(data, ifNoneMatch, { acceptEncoding });
  } catch (error) {
    return toErrorResponse(error, ROUTE);
  }
}
