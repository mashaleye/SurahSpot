import type { NextRequest } from "next/server";

import { badRequest, notFound, toErrorResponse, upstreamError } from "@/lib/http/api-error";
import { jsonWithValidator } from "@/lib/http/conditional";
import { LEARNING_MUSHAF_ID, type LearningSurahData } from "@/lib/learning/types";
import { chooseTranslation, findChapter, getCatalog } from "@/lib/quran/catalog";
import { qfFetch } from "@/lib/quran/client";
import { cleanQuranArabicForDisplay, cleanTranslationHtml } from "@/lib/quran/text";

export const dynamic = "force-dynamic";

const ROUTE = "api/quran/learning/surah";
const CACHE_TTL_MS = 30 * 60_000;
const MAX_CACHE_ENTRIES = 24;
const PER_PAGE = 50;

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

type ApiPagination = {
  current_page: number;
  next_page: number | null;
  per_page: number;
  total_pages: number;
  total_records: number;
};

type ApiResponse = {
  verses: ApiVerse[];
  pagination?: ApiPagination;
};

type CachedSurah = { expiresAt: number; data: LearningSurahData };
const cache = new Map<string, CachedSurah>();

function remember(key: string, data: LearningSurahData) {
  cache.delete(key);
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function buildPath(chapterId: number, translationId: number, page: number) {
  const params = new URLSearchParams({
    language: "en",
    mushaf: String(LEARNING_MUSHAF_ID),
    words: "false",
    page: String(page),
    per_page: String(PER_PAGE),
    fields: "chapter_id,text_uthmani",
    translations: String(translationId),
    translation_fields: "resource_name,language_name",
  });
  return `/verses/by_chapter/${chapterId}?${params.toString()}`;
}

export async function GET(request: NextRequest) {
  try {
    const chapterId = Number(request.nextUrl.searchParams.get("chapter"));
    const language = String(request.nextUrl.searchParams.get("language") ?? "english").trim().toLowerCase();
    const ifNoneMatch = request.headers.get("if-none-match");
    const acceptEncoding = request.headers.get("accept-encoding");

    if (!Number.isInteger(chapterId) || chapterId < 1 || chapterId > 114) {
      throw badRequest("Choose a valid Surah.");
    }

    const catalog = await getCatalog();
    const chapter = findChapter(catalog, chapterId);
    if (!chapter) throw notFound("Could not find that Surah.");

    const translation = chooseTranslation(catalog.translations, language)
      ?? chooseTranslation(catalog.translations, "english");
    if (!translation) throw notFound("No translation resource is available right now.");

    const cacheKey = `${chapterId}:${translation.id}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      cache.delete(cacheKey);
      cache.set(cacheKey, cached);
      return jsonWithValidator(cached.data, ifNoneMatch, { acceptEncoding });
    }

    const first = await qfFetch<ApiResponse>(buildPath(chapterId, translation.id, 1));
    const totalPages = Math.max(1, first.pagination?.total_pages ?? Math.ceil(chapter.verses_count / PER_PAGE));

    const remaining = totalPages > 1
      ? await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, index) => index + 2).map((page) =>
            qfFetch<ApiResponse>(buildPath(chapterId, translation.id, page)),
          ),
        )
      : [];

    const apiVerses = [first, ...remaining]
      .flatMap((result) => result.verses ?? [])
      .filter((verse) => verse.chapter_id === chapterId)
      .sort((a, b) => a.verse_number - b.verse_number);

    if (!apiVerses.length) {
      throw upstreamError(`Quran Foundation returned no Ayahs for ${chapter.name_simple}.`);
    }

    if (apiVerses.length !== chapter.verses_count) {
      throw upstreamError(
        `Quran Foundation returned ${apiVerses.length} of ${chapter.verses_count} Ayahs for ${chapter.name_simple}.`,
      );
    }

    const data: LearningSurahData = {
      chapter: {
        id: chapter.id,
        nameSimple: chapter.name_simple,
        nameArabic: chapter.name_arabic,
        translatedName: chapter.translated_name?.name ?? "",
        versesCount: chapter.verses_count,
      },
      pages: Array.from(new Set(apiVerses.map((verse) => verse.page_number).filter(Number.isFinite))).sort((a, b) => a - b),
      juzNumbers: Array.from(new Set(apiVerses.map((verse) => verse.juz_number).filter(Number.isFinite))).sort((a, b) => a - b),
      hizbNumbers: Array.from(new Set(apiVerses.map((verse) => verse.hizb_number).filter(Number.isFinite))).sort((a, b) => a - b),
      verses: apiVerses.map((verse) => ({
        chapterId: verse.chapter_id,
        verseNumber: verse.verse_number,
        verseKey: verse.verse_key,
        pageNumber: verse.page_number,
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
