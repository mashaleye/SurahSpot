import { NextRequest, NextResponse } from "next/server";

import { findChapter, getCatalog } from "@/lib/quran/catalog";
import { qfFetch } from "@/lib/quran/client";
import { badRequest, notFound, toErrorResponse, upstreamError } from "@/lib/http/api-error";
import { LEARNING_MUSHAF_ID, LEARNING_TOTAL_PAGES } from "@/lib/learning/types";

export const dynamic = "force-dynamic";

const ROUTE = "api/quran/learning/navigate";

type ApiVerse = {
  chapter_id: number;
  verse_number: number;
  verse_key: string;
  page_number?: number;
  juz_number?: number;
};

function verseQuery(page: number) {
  const params = new URLSearchParams({
    page: String(page),
    per_page: "1",
    words: "false",
    mushaf: String(LEARNING_MUSHAF_ID),
    fields: "chapter_id,page_number,juz_number",
  });
  return params.toString();
}

export async function GET(request: NextRequest) {
  try {
    const type = String(request.nextUrl.searchParams.get("type") ?? "page").trim().toLowerCase();

    if (type === "page") {
      const pageNumber = Number(request.nextUrl.searchParams.get("page"));
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > LEARNING_TOTAL_PAGES) {
        throw badRequest(`Page must be between 1 and ${LEARNING_TOTAL_PAGES}.`);
      }
      const params = new URLSearchParams({
        page: "1",
        per_page: "1",
        words: "false",
        mushaf: String(LEARNING_MUSHAF_ID),
        fields: "chapter_id,page_number,juz_number",
      });
      const result = await qfFetch<{ verses: ApiVerse[] }>(
        `/verses/by_page/${pageNumber}?${params.toString()}`,
      );
      const verse = result.verses?.[0];
      if (!verse) throw upstreamError(`Could not resolve page ${pageNumber} to a Surah.`);
      return NextResponse.json({
        pageNumber,
        verseKey: verse.verse_key,
        chapterId: verse.chapter_id,
        verseNumber: verse.verse_number,
        juzNumber: verse.juz_number ?? undefined,
      });
    }

    if (type === "juz") {
      const juzNumber = Number(request.nextUrl.searchParams.get("juz"));
      if (!Number.isInteger(juzNumber) || juzNumber < 1 || juzNumber > 30) {
        throw badRequest("Juz must be between 1 and 30.");
      }
      const result = await qfFetch<{ verses: ApiVerse[] }>(
        `/verses/by_juz/${juzNumber}?${verseQuery(1)}`,
      );
      const verse = result.verses?.[0];
      if (!verse?.page_number) throw upstreamError(`Could not resolve Juz ${juzNumber} to a Mushaf page.`);
      return NextResponse.json({
        pageNumber: verse.page_number,
        verseKey: verse.verse_key,
        chapterId: verse.chapter_id,
        verseNumber: verse.verse_number,
        juzNumber,
      });
    }

    const chapterId = Number(request.nextUrl.searchParams.get("chapter"));
    if (!Number.isInteger(chapterId) || chapterId < 1 || chapterId > 114) {
      throw badRequest("Choose a valid Surah.");
    }

    const catalog = await getCatalog();
    const chapter = findChapter(catalog, chapterId);
    if (!chapter) throw notFound("Could not find that Surah.");

    const verseNumber = type === "verse"
      ? Number(request.nextUrl.searchParams.get("verse"))
      : 1;

    if (type !== "surah" && type !== "verse") {
      throw badRequest("Navigation type must be Surah, Verse, Juz, or Page.");
    }
    if (!Number.isInteger(verseNumber) || verseNumber < 1 || verseNumber > chapter.verses_count) {
      throw badRequest(`${chapter.name_simple} has ${chapter.verses_count} Ayahs.`);
    }

    // The by_chapter endpoint is paginated by Ayah position. Requesting page=N
    // with per_page=1 gives the Nth Ayah without downloading the whole Surah.
    const result = await qfFetch<{ verses: ApiVerse[] }>(
      `/verses/by_chapter/${chapterId}?${verseQuery(verseNumber)}`,
    );
    const verse = result.verses?.[0];
    if (!verse || verse.chapter_id !== chapterId || verse.verse_number !== verseNumber || !verse.page_number) {
      throw upstreamError(`Could not resolve ${chapter.name_simple} ${verseNumber} to a Mushaf page.`);
    }

    return NextResponse.json({
      pageNumber: verse.page_number,
      verseKey: verse.verse_key,
      chapterId,
      verseNumber,
      juzNumber: verse.juz_number ?? undefined,
    });
  } catch (error) {
    return toErrorResponse(error, ROUTE);
  }
}
