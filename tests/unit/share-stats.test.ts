import { describe, expect, it } from "vitest";
import { newAttemptRecord, recordShareRoundResult } from "@/lib/game/attempt";

describe("spoiler-free attempt share stats", () => {
  it("records score, streak and round state without gameplay answers", () => {
    const attempt = newAttemptRecord("attempt-share");
    recordShareRoundResult(attempt, { points: 100, correct: true, attemptsUsedBeforeSuccess: 0 });
    recordShareRoundResult(attempt, { points: 80, correct: true, attemptsUsedBeforeSuccess: 1 });
    recordShareRoundResult(attempt, { points: 0, correct: false });

    expect(attempt.shareStats).toMatchObject({
      totalScore: 180,
      roundsWon: 2,
      currentStreak: 0,
      bestStreak: 2,
      firstTryWins: 1,
      roundStates: ["perfect", "close", "missed"],
    });
    expect(JSON.stringify(attempt.shareStats)).not.toMatch(/chapter|verse|answer|surah/i);
  });

  it("tracks Closest Figure proximity as an aggregate only", () => {
    const attempt = newAttemptRecord("attempt-share");
    recordShareRoundResult(attempt, { points: 72, correct: false, proximity: 82 });
    recordShareRoundResult(attempt, { points: 90, correct: true, exact: true, proximity: 100 });
    expect(attempt.shareStats.proximityTotal).toBe(182);
    expect(attempt.shareStats.proximityRounds).toBe(2);
    expect(attempt.shareStats.exact).toBe(1);
  });
});
