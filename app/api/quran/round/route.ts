import { NextRequest, NextResponse } from "next/server";
import { getCatalog } from "@/lib/quran/catalog";
import { sealRound } from "@/lib/quran/round-token";
import { buildRound, sanitizeExcludedChapters } from "@/lib/game/round-builder";
import { buildAyahCountRound } from "@/lib/game/ayah-count-builder";
import { buildCompletionRound, type CompletionVariant } from "@/lib/game/completion-builder";
import { getMode, getVariant } from "@/lib/game/modes";
import {
  ATTEMPT_COOKIE_NAME,
  attemptCookieOptions,
  createAttempt,
  loadAttempt,
  loadOrCreateAttempt,
  newRoundId,
  saveAttempt,
} from "@/lib/game/attempt-service";
import { attemptProgress, canStartNewAttempt, hintStatus, registerRound } from "@/lib/game/attempt";
import { MAX_TRIES_PER_ROUND, STARTING_POINTS } from "@/lib/game/rules";
import { conflict, toErrorResponse } from "@/lib/http/api-error";
import { enforceRateLimit, rateLimitIdentities } from "@/lib/http/rate-limit";
import { rateLimits } from "@/lib/config/env";

export const dynamic = "force-dynamic";

const ROUTE = "api/quran/round";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const language = typeof body.language === "string" ? body.language : "english";
    const mode = getMode(body.mode);
    const variant = getVariant(mode, body.variant);
    const variantId = variant?.id;
    const preferredReciterId = Number.isFinite(Number(body.reciterId)) ? Number(body.reciterId) : undefined;
    const excludedChapterIds = sanitizeExcludedChapters(body.excludeChapterIds);

    // Hint allowance and round count are attempt-scoped and live behind an
    // HttpOnly cookie plus server-side state. The browser never gets to declare
    // how many hints it has used or how far into the attempt it is.
    const cookieAttemptId = request.cookies.get(ATTEMPT_COOKIE_NAME)?.value;

    const limits = rateLimits();
    if (limits.enabled) {
      // Building a round fans out to several upstream calls, so it carries the
      // tightest budget of any endpoint.
      await enforceRateLimit("round", rateLimitIdentities(request, cookieAttemptId), limits.roundPerMinute);
    }

    const existingAttempt = await loadAttempt(cookieAttemptId);
    const wantsNewAttempt = body.newAttempt === true;
    const isModeSwitch = body.resetReason === "mode-switch";
    const isChallenge = body.resetReason === "challenge";
    const existingVariantId = existingAttempt?.mode
      ? getVariant(getMode(existingAttempt.mode), existingAttempt.variant)?.id
      : undefined;
    const selectionChanged = Boolean(
      existingAttempt?.mode &&
      (existingAttempt.mode !== mode.id || existingVariantId !== variantId),
    );

    if (wantsNewAttempt && !canStartNewAttempt(existingAttempt)) {
      // A live attempt cannot normally be rerolled in-place. Two explicit user
      // actions are allowed to start fresh: switching game rules, or accepting
      // a shared-result challenge (which starts fresh rounds in that mode).
      if (!isChallenge && (!isModeSwitch || (existingAttempt?.mode && !selectionChanged))) {
        throw conflict("The current seven-round attempt is still active.");
      }
    }

    const attempt = wantsNewAttempt
      ? await createAttempt()
      : (existingAttempt ?? await loadOrCreateAttempt(null));

    // Old attempt records (from before modes were persisted) are adopted by
    // the first round after deployment. Once bound, a normal next-round call
    // may not silently change the rules; switching requires a fresh attempt.
    if (!attempt.mode) {
      attempt.mode = mode.id;
      attempt.variant = variantId;
    } else {
      const attemptVariantId = getVariant(getMode(attempt.mode), attempt.variant)?.id;
      if (!wantsNewAttempt && (attempt.mode !== mode.id || attemptVariantId !== variantId)) {
        throw conflict("Switch modes to start a new attempt with those rules.");
      }
      if (wantsNewAttempt) {
        attempt.mode = mode.id;
        attempt.variant = variantId;
      } else if (attempt.variant !== attemptVariantId) {
        // Normalize a legacy/malformed variant to the registry default so the
        // persisted attempt and the token agree from this point forward.
        attempt.variant = attemptVariantId;
      }
    }

    const catalog = await getCatalog();

    // Ayah Counts needs nothing from upstream beyond the cached catalog, so it
    // returns here without touching the recitation path at all — which also
    // means it stays playable while Quran Foundation is degraded.
    if (mode.answerKind === "ayah-count") {
      const ayahRound = buildAyahCountRound({ catalog, excludedChapterIds });
      const registration = registerRound(attempt, newRoundId());
      await saveAttempt(attempt);

      const token = sealRound({
        chapterId: ayahRound.chapterId,
        versesCount: ayahRound.versesCount,
        attemptsUsed: 0,
        hintPenalty: 0,
        attemptId: attempt.id,
        roundId: registration.roundId,
        revision: registration.revision,
        issuedAt: Date.now(),
        mode: mode.id,
        variant: variant?.id,
        tryScores: [],
      });

      const response = NextResponse.json({
        token,
        mode: mode.id,
        variant: variant?.id,
        // The Surah is the prompt here, not the answer, so naming it is correct.
        // The verse count is what stays sealed.
        surah: ayahRound.display,
        attemptsRemaining: MAX_TRIES_PER_ROUND,
        pointsRemaining: STARTING_POINTS,
        progress: attemptProgress(attempt),
      });

      response.cookies.set(ATTEMPT_COOKIE_NAME, attempt.id, attemptCookieOptions());
      return response;
    }

    if (mode.answerKind === "completion") {
      const completion = await buildCompletionRound({
        catalog,
        language,
        preferredReciterId,
        excludedChapterIds,
        variant: (variant?.id === "sequence" ? "sequence" : "fill-in") as CompletionVariant,
        difficultyLevel: attempt.roundsCompleted,
      });
      const registration = registerRound(attempt, newRoundId());
      await saveAttempt(attempt);

      const token = sealRound({
        mode: mode.id,
        variant: completion.variant,
        verseKey: completion.promptVerseKeys[0],
        chapterId: completion.chapterId,
        reciterId: completion.audio.reciterId,
        audioUrl: completion.audio.url,
        completionCorrectChoiceIds: completion.correctChoiceIds,
        completionPromptVerseKeys: completion.promptVerseKeys,
        completionTargetVerseKeys: completion.targetVerseKeys,
        attemptsUsed: 0,
        hintPenalty: 0,
        attemptId: attempt.id,
        roundId: registration.roundId,
        revision: registration.revision,
        issuedAt: Date.now(),
      });

      const response = NextResponse.json({
        token,
        mode: mode.id,
        variant: completion.variant,
        surah: completion.surah,
        completion: {
          difficultyLevel: completion.difficultyLevel,
          blankCount: completion.blankCount,
          prompt: completion.prompt,
          choices: completion.choices,
        },
        words: completion.words,
        arabic: completion.arabic,
        transliteration: completion.transliteration,
        translation: completion.translation,
        translationMeta: completion.translationMeta,
        audio: {
          url: `/api/quran/audio?token=${encodeURIComponent(token)}`,
          fromMs: completion.audio.fromMs,
          toMs: completion.audio.toMs,
          segments: completion.audio.segments,
          reciter: completion.audio.reciter,
          reciterId: completion.audio.reciterId,
          requestedReciterId: completion.audio.requestedReciterId,
          usedFallbackReciter: completion.audio.usedFallbackReciter,
        },
        attemptsRemaining: MAX_TRIES_PER_ROUND,
        pointsRemaining: STARTING_POINTS,
        progress: attemptProgress(attempt),
      });

      response.cookies.set(ATTEMPT_COOKIE_NAME, attempt.id, attemptCookieOptions());
      return response;
    }

    const round = await buildRound({ catalog, language, preferredReciterId, excludedChapterIds });

    // Registering the round throws once the attempt has used its seven, which
    // is the server-side backstop for a client that tampered with its own round
    // counter in localStorage.
    const registration = registerRound(attempt, newRoundId());
    await saveAttempt(attempt);

    const token = sealRound({
      mode: mode.id,
      verseKey: round.verseKey,
      chapterId: round.chapterId,
      reciterId: round.audio.reciterId,
      audioUrl: round.audio.url,
      attemptsUsed: 0,
      hintPenalty: 0,
      attemptId: attempt.id,
      roundId: registration.roundId,
      revision: registration.revision,
      issuedAt: Date.now(),
    });

    const response = NextResponse.json({
      token,
      mode: mode.id,
      words: round.words,
      arabic: round.arabic,
      transliteration: round.transliteration,
      translation: round.translation,
      translationMeta: round.translationMeta,
      audio: {
        // The upstream URL is never sent: its filename encodes the chapter
        // number, which is the answer. The proxy resolves it from the token.
        url: `/api/quran/audio?token=${encodeURIComponent(token)}`,
        fromMs: round.audio.fromMs,
        toMs: round.audio.toMs,
        segments: round.audio.segments,
        reciter: round.audio.reciter,
        reciterId: round.audio.reciterId,
        requestedReciterId: round.audio.requestedReciterId,
        usedFallbackReciter: round.audio.usedFallbackReciter,
      },
      attemptsRemaining: MAX_TRIES_PER_ROUND,
      pointsRemaining: STARTING_POINTS,
      hints: hintStatus(attempt),
      // Echoed so a client whose localStorage was cleared, tampered with, or
      // left behind by a refresh can reconcile against the server's count.
      progress: attemptProgress(attempt),
    });

    response.cookies.set(ATTEMPT_COOKIE_NAME, attempt.id, attemptCookieOptions());
    return response;
  } catch (error) {
    return toErrorResponse(error, ROUTE);
  }
}
