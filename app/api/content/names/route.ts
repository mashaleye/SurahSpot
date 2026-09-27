import { NextRequest, NextResponse } from "next/server";
import { REQUESTED_LANGUAGES } from "@/lib/quran/languages";
import { getNamesOfAllah } from "@/lib/content/names-of-allah";
import { badRequest, toErrorResponse } from "@/lib/http/api-error";
import { enforceRateLimit, rateLimitIdentities } from "@/lib/http/rate-limit";
import { rateLimits } from "@/lib/config/env";

export const dynamic = "force-dynamic";
const ROUTE = "api/content/names";
const LANGUAGES = new Set<string>(REQUESTED_LANGUAGES);

export async function GET(request: NextRequest) {
  try {
    const language = (request.nextUrl.searchParams.get("language") ?? "english").trim().toLowerCase();
    if (!LANGUAGES.has(language)) throw badRequest("Unsupported project language.");

    const limits = rateLimits();
    if (limits.enabled) {
      await enforceRateLimit("names", rateLimitIdentities(request), Math.max(20, Math.floor(limits.searchPerMinute / 2)));
    }

    const result = await getNamesOfAllah(language);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=3600" },
    });
  } catch (error) {
    return toErrorResponse(error, ROUTE);
  }
}
