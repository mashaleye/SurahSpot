import { NextRequest, NextResponse } from "next/server";
import { chooseTranslation, getCatalog } from "@/lib/quran/catalog";
import { qfFetch } from "@/lib/quran/client";
import { openRound } from "@/lib/quran/round-token";
import { cleanTranslationHtml } from "@/lib/quran/text";
import { badRequest, notFound, toErrorResponse, upstreamError } from "@/lib/http/api-error";
import { enforceRateLimit, rateLimitIdentities } from "@/lib/http/rate-limit";
import { ATTEMPT_COOKIE_NAME } from "@/lib/game/attempt-service";
import { rateLimits } from "@/lib/config/env";

export const dynamic = "force-dynamic";

const ROUTE = "api/quran/translate";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = String(body.token ?? "");
    const language = String(body.language ?? "english");

    // The verse key is read from the sealed token, never from the request. The
    // browser can ask to re-translate "the current ayah" but cannot name a
    // different one, so this endpoint is not a lookup oracle for the answer.
    const round = openRound(token);

    // Nothing to translate in a mode that shows no Ayah.
    if (!round.verseKey) {
      throw badRequest("This round has no Ayah to translate.");
    }

    const limits = rateLimits();
    if (limits.enabled) {
      const attemptId = request.cookies.get(ATTEMPT_COOKIE_NAME)?.value;
      await enforceRateLimit("action", rateLimitIdentities(request, attemptId), limits.actionPerMinute);
    }

    const catalog = await getCatalog();
    const translation = chooseTranslation(catalog.translations, language);
    if (!translation) {
      throw notFound(`No Quran Foundation translation resource is currently available for ${language}.`);
    }

    const keys = round.mode === "completion" && Array.isArray(round.completionPromptVerseKeys)
      ? round.completionPromptVerseKeys
      : [round.verseKey];
    const translated = await Promise.all(keys.map(async (verseKey) => {
      const data = await qfFetch<{ translations: Array<{ text: string }> }>(
        `/quran/translations/${translation.id}?verse_key=${encodeURIComponent(verseKey)}&fields=resource_name,language_name`,
      );
      const item = data.translations?.[0];
      if (!item) throw upstreamError("The translation response was empty.");
      return cleanTranslationHtml(item.text);
    }));

    return NextResponse.json({
      translation: translated.join(" "),
      completionTranslations: round.mode === "completion" ? translated : undefined,
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
