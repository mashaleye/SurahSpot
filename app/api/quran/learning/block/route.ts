import { NextRequest, NextResponse } from "next/server";
import { chooseTranslation, findChapter, getCatalog } from "@/lib/quran/catalog";
import { qfFetch } from "@/lib/quran/client";
import { badRequest, notFound, toErrorResponse, upstreamError } from "@/lib/http/api-error";
import { cleanQuranArabicForDisplay, cleanTranslationHtml } from "@/lib/quran/text";

export const dynamic = "force-dynamic";
const ROUTE = "api/quran/learning/block";
const MAX_SEQUENCE_BLOCK = 10;

type ApiVerse = {
  chapter_id: number;
  verse_number: number;
  verse_key: string;
  page_number?: number;
  juz_number?: number;
  hizb_number?: number;
  text_uthmani?: string;
  translations?: Array<{ resource_id: number; text: string }>;
};

function versePath(chapterId: number, verseNumber: number, translationId: number) {
  const params = new URLSearchParams({
    page: String(verseNumber),
    per_page: "1",
    words: "false",
    fields: "chapter_id,text_uthmani",
    translations: String(translationId),
    translation_fields: "resource_name,language_name",
  });
  return `/verses/by_chapter/${chapterId}?${params.toString()}`;
}

export async function GET(request: NextRequest) {
  try {
    const chapterId = Number(request.nextUrl.searchParams.get("chapter"));
    const start = Number(request.nextUrl.searchParams.get("start"));
    const end = Number(request.nextUrl.searchParams.get("end"));
    const language = String(request.nextUrl.searchParams.get("language") ?? "english").trim().toLowerCase();

    if (!Number.isInteger(chapterId) || chapterId < 1 || chapterId > 114) {
      throw badRequest("Choose a valid Surah.");
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      throw badRequest("Choose a valid Ayah range.");
    }
    const count = end - start + 1;
    if (count < 2 || count > MAX_SEQUENCE_BLOCK) {
      throw badRequest(`Sequence blocks must contain between 2 and ${MAX_SEQUENCE_BLOCK} Ayahs.`);
    }

    const catalog = await getCatalog();
    const chapter = findChapter(catalog, chapterId);
    if (!chapter) throw notFound("Could not find that Surah.");
    if (end > chapter.verses_count) {
      throw badRequest(`${chapter.name_simple} has ${chapter.verses_count} Ayahs.`);
    }

    const translation = chooseTranslation(catalog.translations, language)
      ?? chooseTranslation(catalog.translations, "english");
    if (!translation) throw notFound("No translation resource is available right now.");

    const apiVerses = await Promise.all(
      Array.from({ length: count }, (_, offset) => start + offset).map(async (verseNumber) => {
        const response = await qfFetch<{ verses: ApiVerse[] }>(
          versePath(chapterId, verseNumber, translation.id),
        );
        const verse = response.verses?.[0];
        if (!verse || verse.chapter_id !== chapterId || verse.verse_number !== verseNumber) {
          throw upstreamError(`Quran Foundation returned an unexpected Ayah for ${chapterId}:${verseNumber}.`);
        }
        return verse;
      }),
    );

    return NextResponse.json({
      chapter: {
        id: chapter.id,
        nameSimple: chapter.name_simple,
        nameArabic: chapter.name_arabic,
        translatedName: chapter.translated_name?.name ?? "",
        versesCount: chapter.verses_count,
      },
      start,
      end,
      verses: apiVerses.map((verse) => ({
        chapterId: verse.chapter_id,
        verseNumber: verse.verse_number,
        verseKey: verse.verse_key,
        pageNumber: verse.page_number ?? 0,
        juzNumber: verse.juz_number ?? 0,
        hizbNumber: verse.hizb_number ?? 0,
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
    });
  } catch (error) {
    return toErrorResponse(error, ROUTE);
  }
}
