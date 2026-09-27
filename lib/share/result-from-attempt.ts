import "server-only";

import { MAX_ATTEMPT_ROUNDS } from "@/lib/game/rules";
import type { AttemptRecord } from "@/lib/game/attempt";
import type { ShareResultPayload } from "./result-types";

/** Build a spoiler-free public result exclusively from server-owned attempt data. */
export function shareResultFromAttempt(attempt: AttemptRecord): ShareResultPayload {
  if (!attempt.mode || attempt.roundsCompleted < MAX_ATTEMPT_ROUNDS) {
    throw new Error("Only completed SurahSpot attempts can be shared.");
  }

  const stats = attempt.shareStats;
  if (stats.roundStates.length !== attempt.roundsCompleted) {
    throw new Error("This attempt predates share-safe result tracking. Start a new attempt to share a verified result.");
  }
  const averageProximity = stats.proximityRounds > 0
    ? Math.round(stats.proximityTotal / stats.proximityRounds)
    : undefined;

  return {
    version: 1,
    mode: attempt.mode,
    variant: attempt.variant,
    score: stats.totalScore,
    roundsPlayed: attempt.roundsCompleted,
    roundsWon: stats.roundsWon,
    bestStreak: stats.bestStreak,
    exact: stats.exact,
    firstTryWins: stats.firstTryWins,
    averageProximity,
    roundStates: stats.roundStates.slice(0, MAX_ATTEMPT_ROUNDS),
    createdAt: Date.now(),
  };
}
