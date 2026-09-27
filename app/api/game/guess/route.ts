import { NextRequest, NextResponse } from "next/server";
import { findChapter, getCatalog } from "@/lib/quran/catalog";
import { openRound, sealRound } from "@/lib/quran/round-token";
import {
  ATTEMPT_COOKIE_NAME,
  mutateAttempt,
} from "@/lib/game/attempt-service";
import {
  assertRoundActive,
  attemptProgress,
  finishRound,
  recordShareRoundResult,
  rotateRoundRevision,
} from "@/lib/game/attempt";
import {
  isRoundExhausted,
  isValidChapterId,
  pointsForCorrectGuess,
  potentialPoints,
  triesRemaining,
} from "@/lib/game/rules";
import { badRequest, conflict, toErrorResponse, unavailable } from "@/lib/http/api-error";
import {
  closestFigureCeiling,
  closestFigureRoundScore,
  closestFigureScore,
  exactFigureScore,
  guessDirection,
  isValidAyahGuess,
} from "@/lib/game/scoring-ayah-count";
import { enforceRateLimit, rateLimitIdentities } from "@/lib/http/rate-limit";
import { rateLimits } from "@/lib/config/env";

export const dynamic = "force-dynamic";

const ROUTE = "api/game/guess";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = String(body.token ?? "");
    const skip = body.skip === true;
    const skipRound = body.skipRound === true;
    const guessChapterId = Number(body.chapterId);

    const round = openRound(token);
    const isAyahCounts = round.mode === "ayah-counts";
    const isCompletion = round.mode === "completion";
    const ayahGuess = Number(body.ayahCount);
    const completionChoiceId = typeof body.completionChoiceId === "string" ? body.completionChoiceId : "";
    const completionOrder = Array.isArray(body.completionOrder)
      ? body.completionOrder.filter((id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 80)
      : [];

    if (!skip && !skipRound) {
      if (isAyahCounts) {
        if (!isValidAyahGuess(ayahGuess)) {
          throw badRequest("Enter an Ayah count between 1 and 300.");
        }
      } else if (isCompletion) {
        const expected = round.completionCorrectChoiceIds ?? [];
        if (round.variant === "sequence") {
          if (completionOrder.length !== expected.length || new Set(completionOrder).size !== completionOrder.length) {
            throw badRequest(`Place all ${expected.length} Ayah${expected.length === 1 ? "" : "s"} before submitting.`);
          }
        } else if (!completionChoiceId || completionChoiceId.length > 80) {
          throw badRequest("Choose an Ayah before submitting.");
        }
      } else if (!isValidChapterId(guessChapterId)) {
        throw badRequest("Choose a Surah before submitting.");
      }
    }

    // The token proves which round this is; the cookie proves it is this
    // browser's attempt. Requiring both stops a token lifted from one session
    // being replayed in another.
    const cookieAttemptId = request.cookies.get(ATTEMPT_COOKIE_NAME)?.value;
    if (!cookieAttemptId || cookieAttemptId !== round.attemptId) {
      throw conflict("This attempt session is no longer valid. Reload SurahSpot to start again.");
    }

    const limits = rateLimits();
    if (limits.enabled) {
      await enforceRateLimit("action", rateLimitIdentities(request, cookieAttemptId), limits.actionPerMinute);
    }

    const catalog = await getCatalog();
    const answer = findChapter(catalog, round.chapterId);
    if (!answer) throw unavailable("Could not resolve the Surah answer right now.");

    const reveal = {
      verseKey: round.verseKey,
      chapterId: answer.id,
      nameSimple: answer.name_simple,
      nameArabic: answer.name_arabic,
      translatedName: answer.translated_name?.name ?? "",
    };

    // Everything that changes state happens inside one locked, persisted
    // mutation, so a hint and a guess arriving together cannot both consume the
    // same round revision.
    const payload = await mutateAttempt(cookieAttemptId, (attempt) => {
      // Consuming the current revision is what makes a saved pre-hint token
      // useless for rolling back the 3-point second-hint cost.
      assertRoundActive(attempt, round.roundId, round.revision);

      if (isAyahCounts) {
        return scoreAyahCountGuess({
          round,
          attempt,
          ayahGuess,
          skip,
          skipRound,
          reveal,
        });
      }

      if (isCompletion) {
        return scoreCompletionGuess({
          round,
          attempt,
          completionChoiceId,
          completionOrder,
          skip,
          skipRound,
          reveal,
        });
      }

      // Double-forward skip: end the whole round immediately at 0 points.
      if (skipRound) {
        finishRound(attempt, round.roundId, round.revision);
        recordShareRoundResult(attempt, { points: 0, correct: false, skipped: true });
        return {
          correct: false,
          exhausted: true,
          skippedRound: true,
          points: 0,
          pointsRemaining: 0,
          attemptsRemaining: 0,
          reveal,
          progress: attemptProgress(attempt),
        };
      }

      const correct = !skip && guessChapterId === round.chapterId;
      if (correct) {
        const points = pointsForCorrectGuess(round.attemptsUsed, round.hintPenalty);
        finishRound(attempt, round.roundId, round.revision);
        recordShareRoundResult(attempt, {
          points,
          correct: true,
          attemptsUsedBeforeSuccess: round.attemptsUsed,
        });
        return {
          correct: true,
          points,
          attemptsRemaining: triesRemaining(round.attemptsUsed),
          reveal,
          progress: attemptProgress(attempt),
        };
      }

      const attemptsUsed = round.attemptsUsed + 1;
      if (isRoundExhausted(attemptsUsed)) {
        finishRound(attempt, round.roundId, round.revision);
        recordShareRoundResult(attempt, { points: 0, correct: false });
        return {
          correct: false,
          exhausted: true,
          points: 0,
          pointsRemaining: 0,
          attemptsRemaining: 0,
          reveal,
          progress: attemptProgress(attempt),
        };
      }

      const nextRevision = rotateRoundRevision(attempt, round.roundId, round.revision);
      return {
        correct: false,
        exhausted: false,
        // A fresh token at the new revision. The previous one is now stale.
        token: sealRound({ ...round, attemptsUsed, revision: nextRevision }),
        pointsRemaining: potentialPoints(attemptsUsed, round.hintPenalty),
        attemptsRemaining: triesRemaining(attemptsUsed),
        progress: attemptProgress(attempt),
      };
    });

    return NextResponse.json(payload);
  } catch (error) {
    return toErrorResponse(error, ROUTE);
  }
}

type AyahCountGuessInput = {
  round: ReturnType<typeof openRound>;
  attempt: Parameters<Parameters<typeof mutateAttempt>[1]>[0];
  ayahGuess: number;
  skip: boolean;
  skipRound: boolean;
  reveal: { chapterId: number; nameSimple: string; nameArabic: string; translatedName: string };
};

/**
 * Score one guess in the Ayah Counts mode.
 *
 * The two variants diverge in what a try is worth, not in how a round ends:
 *
 * - Exact Figure is the base ladder. A wrong count is simply wrong.
 * - Closest Figure scores every guess by proximity and keeps the best, so a
 *   player who converges is rewarded for converging rather than for being
 *   right first time. The running scores live in the sealed token, and the
 *   revision rotates on every guess, so an earlier better set cannot be
 *   replayed.
 */
function scoreAyahCountGuess({
  round,
  attempt,
  ayahGuess,
  skip,
  skipRound,
  reveal,
}: AyahCountGuessInput) {
  const actual = round.versesCount ?? 0;
  const isClosest = round.variant === "closest";
  const tryScores = Array.isArray(round.tryScores) ? round.tryScores : [];

  const answer = {
    ...reveal,
    versesCount: actual,
  };

  if (skipRound) {
    finishRound(attempt, round.roundId, round.revision);
    recordShareRoundResult(attempt, { points: 0, correct: false, skipped: true });
    return {
      correct: false,
      exhausted: true,
      skippedRound: true,
      points: 0,
      pointsRemaining: 0,
      attemptsRemaining: 0,
      reveal: answer,
      progress: attemptProgress(attempt),
    };
  }

  const attemptsUsed = round.attemptsUsed + 1;
  const correct = !skip && ayahGuess === actual;

  // A skipped try scores nothing but still consumes the try, matching the base
  // game. In Closest Figure it is recorded as a 0 so the best-of calculation
  // cannot be gamed by skipping to dodge a bad guess.
  const thisScore = skip ? 0 : isClosest ? closestFigureScore(ayahGuess, actual) : 0;
  const scores = [...tryScores, thisScore];

  const roundOver = correct || isRoundExhausted(attemptsUsed);

  if (roundOver) {
    finishRound(attempt, round.roundId, round.revision);
    const points = isClosest
      ? closestFigureRoundScore(scores)
      : correct
        ? exactFigureScore(round.attemptsUsed)
        : 0;

    recordShareRoundResult(attempt, {
      points,
      correct,
      attemptsUsedBeforeSuccess: correct ? round.attemptsUsed : undefined,
      exact: correct,
      proximity: isClosest ? Math.max(0, ...scores) : undefined,
    });

    return {
      correct,
      exhausted: !correct,
      points,
      pointsRemaining: points,
      attemptsRemaining: triesRemaining(attemptsUsed),
      // Only meaningful in Closest Figure, where the player wants to see which
      // of their guesses carried the round.
      tryScores: isClosest ? scores : undefined,
      lastGuessScore: isClosest ? thisScore : undefined,
      reveal: answer,
      progress: attemptProgress(attempt),
    };
  }

  const nextRevision = rotateRoundRevision(attempt, round.roundId, round.revision);

  return {
    correct: false,
    exhausted: false,
    token: sealRound({ ...round, attemptsUsed, revision: nextRevision, tryScores: scores }),
    // Direction only, never distance: enough to turn five stabs into a
    // convergence, not enough to solve it.
    direction: skip ? undefined : guessDirection(ayahGuess, actual),
    lastGuessScore: isClosest && !skip ? thisScore : undefined,
    bestScore: isClosest ? Math.max(...scores) : undefined,
    tryScores: isClosest ? scores : undefined,
    // What the round is worth if the player stops here. Distinct from the
    // ceiling below, which is what a perfect next guess could still reach.
    pointsRemaining: isClosest ? closestFigureRoundScore(scores) : exactFigureScore(attemptsUsed),
    ceiling: isClosest ? closestFigureCeiling(attemptsUsed) : undefined,
    attemptsRemaining: triesRemaining(attemptsUsed),
    progress: attemptProgress(attempt),
  };
}


type CompletionGuessInput = {
  round: ReturnType<typeof openRound>;
  attempt: Parameters<Parameters<typeof mutateAttempt>[1]>[0];
  completionChoiceId: string;
  completionOrder: string[];
  skip: boolean;
  skipRound: boolean;
  reveal: { verseKey?: string; chapterId: number; nameSimple: string; nameArabic: string; translatedName: string };
};

/** Completion uses the standard 100/80/60/40/20 ladder and five tries. */
function scoreCompletionGuess({
  round,
  attempt,
  completionChoiceId,
  completionOrder,
  skip,
  skipRound,
  reveal,
}: CompletionGuessInput) {
  const expected = round.completionCorrectChoiceIds ?? [];
  const isSequence = round.variant === "sequence";
  const submitted = isSequence ? completionOrder : [completionChoiceId];
  const correctPositions = isSequence
    ? expected.map((id, index) => submitted[index] === id)
    : [submitted[0] === expected[0]];
  const correct = !skip && correctPositions.every(Boolean);

  if (skipRound) {
    finishRound(attempt, round.roundId, round.revision);
    recordShareRoundResult(attempt, { points: 0, correct: false, skipped: true });
    return {
      correct: false,
      exhausted: true,
      skippedRound: true,
      points: 0,
      pointsRemaining: 0,
      attemptsRemaining: 0,
      correctPositions: expected.map(() => false),
      correctChoiceIds: expected,
      reveal,
      progress: attemptProgress(attempt),
    };
  }

  if (correct) {
    const points = pointsForCorrectGuess(round.attemptsUsed, 0);
    finishRound(attempt, round.roundId, round.revision);
    recordShareRoundResult(attempt, {
      points,
      correct: true,
      attemptsUsedBeforeSuccess: round.attemptsUsed,
    });
    return {
      correct: true,
      points,
      pointsRemaining: points,
      attemptsRemaining: triesRemaining(round.attemptsUsed),
      correctPositions,
      correctChoiceIds: expected,
      reveal,
      progress: attemptProgress(attempt),
    };
  }

  const attemptsUsed = round.attemptsUsed + 1;
  if (isRoundExhausted(attemptsUsed)) {
    finishRound(attempt, round.roundId, round.revision);
    recordShareRoundResult(attempt, { points: 0, correct: false });
    return {
      correct: false,
      exhausted: true,
      points: 0,
      pointsRemaining: 0,
      attemptsRemaining: 0,
      correctPositions: skip ? expected.map(() => false) : correctPositions,
      correctChoiceIds: expected,
      reveal,
      progress: attemptProgress(attempt),
    };
  }

  const nextRevision = rotateRoundRevision(attempt, round.roundId, round.revision);
  return {
    correct: false,
    exhausted: false,
    token: sealRound({ ...round, attemptsUsed, revision: nextRevision }),
    pointsRemaining: potentialPoints(attemptsUsed, 0),
    attemptsRemaining: triesRemaining(attemptsUsed),
    correctPositions: skip ? expected.map(() => false) : correctPositions,
    progress: attemptProgress(attempt),
  };
}
