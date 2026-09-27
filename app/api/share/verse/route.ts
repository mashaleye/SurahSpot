import { NextRequest, NextResponse } from "next/server";
import { ATTEMPT_COOKIE_NAME, loadAttempt } from "@/lib/game/attempt-service";
import { chooseTranslation, getCatalog } from "@/lib/quran/catalog";
import { openRound } from "@/lib/quran/round-token";
import { badRequest, conflict, notFound, toErrorResponse } from "@/lib/http/api-error";
import { enforceRateLimit, rateLimitIdentities } from "@/lib/http/rate-limit";
import { rateLimits } from "@/lib/config/env";
import { loadSharedVerse } from "@/lib/share/verse-data";
import { sealShareVerse } from "@/lib/share/verse-token";
import type { ShareVersePayload } from "@/lib/share/verse-types";

export const dynamic = "force-dynamic";
const ROUTE = "api/share/verse";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const roundToken = String(body.token ?? "");
    const language = typeof body.language === "string" ? body.language : "english";
    const round = openRound(roundToken);
    if (!round.verseKey) throw badRequest("This round does not contain a shareable Ayah.");

    const attemptId = request.cookies.get(ATTEMPT_COOKIE_NAME)?.value;
    if (!attemptId || attemptId !== round.attemptId) {
      throw conflict("This round is not part of the active SurahSpot session.");
    }
    const attempt = await loadAttempt(attemptId);
    const roundRecord = attempt?.rounds[round.roundId];
    if (!attempt || !roundRecord?.finished) {
      // Verse sharing is intentionally unavailable during a live recognition
      // round so it can never double as an answer-reveal endpoint.
      throw conflict("Finish this round before sharing its Ayah.");
    }

    const limits = rateLimits();
    if (limits.enabled) {
      await enforceRateLimit("action", rateLimitIdentities(request, attemptId), limits.actionPerMinute);
    }

    const [chapterPart, versePart] = round.verseKey.split(":");
    const chapterId = Number(chapterPart);
    const verseNumber = Number(versePart);
    if (!Number.isInteger(chapterId) || !Number.isInteger(verseNumber)) {
      throw badRequest("This round has an invalid Ayah reference.");
    }

    const catalog = await getCatalog();
    const translation = chooseTranslation(catalog.translations, language) ?? chooseTranslation(catalog.translations, "english");
    if (!translation) throw notFound("No translation resource is available for verse sharing.");

    const payload: ShareVersePayload = {
      version: 1,
      chapterId,
      verseNumber,
      language,
      translationId: translation.id,
      createdAt: Date.now(),
    };
    const verse = await loadSharedVerse(payload);
    const token = sealShareVerse(payload);

    return NextResponse.json({
      path: `/v/${encodeURIComponent(token)}`,
      cardPath: `/api/share/card/verse/${encodeURIComponent(token)}`,
      title: `${verse.nameSimple} ${verse.chapterId}:${verse.verseNumber} · SurahSpot`,
      textTemplate: `SurahSpot\n\n${verse.translation}\n\n${verse.nameSimple} · ${verse.chapterId}:${verse.verseNumber}\n{{SHARE_URL}}`,
    });
  } catch (error) {
    return toErrorResponse(error, ROUTE);
  }
}
