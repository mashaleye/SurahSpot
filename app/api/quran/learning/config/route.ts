import type { NextRequest } from "next/server";
import { getCatalog, languageCatalog } from "@/lib/quran/catalog";
import { LEARNING_TOTAL_PAGES } from "@/lib/learning/types";
import { toErrorResponse } from "@/lib/http/api-error";
import { jsonWithValidator } from "@/lib/http/conditional";

export const dynamic = "force-dynamic";
const ROUTE = "api/quran/learning/config";

/*
 * The chapter catalog and the translation list. Neither changes between
 * deploys, but it is fetched on every cold start of the reader, so it is
 * worth a validator: a revisit costs a 304 instead of the whole catalog.
 */
export async function GET(request: NextRequest) {
  try {
    const catalog = await getCatalog();
    return jsonWithValidator({
      totalPages: LEARNING_TOTAL_PAGES,
      languages: languageCatalog(catalog.translations).map((language) => ({
        id: language.id,
        label: language.label,
        available: language.available,
        resourceId: language.translationId ?? undefined,
        resourceName: language.translationName ?? undefined,
        author: language.authorName ?? undefined,
      })),
      chapters: catalog.chapters.map((chapter) => ({
        id: chapter.id,
        nameSimple: chapter.name_simple,
        nameArabic: chapter.name_arabic,
        translatedName: chapter.translated_name?.name ?? "",
        versesCount: chapter.verses_count,
      })),
    }, request.headers.get("if-none-match"),
      { acceptEncoding: request.headers.get("accept-encoding") });
  } catch (error) {
    return toErrorResponse(error, ROUTE);
  }
}
