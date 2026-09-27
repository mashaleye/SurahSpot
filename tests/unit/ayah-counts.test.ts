import { describe, expect, it } from "vitest";
import {
  MAX_AYAH_GUESS,
  TRY_PENALTY,
  closestFigureCeiling,
  closestFigureExamples,
  closestFigureRoundScore,
  closestFigureScore,
  exactFigureScore,
  guessDirection,
  isAyahCountVariant,
  isValidAyahGuess,
} from "@/lib/game/scoring-ayah-count";
import { GAME_MODES, getMode, getVariant, isModeId } from "@/lib/game/modes";

/**
 * The Closest Figure curve is the whole design of the mode, so it is pinned
 * down here rather than left to feel. These cases encode the properties that
 * make it fair across Surahs of wildly different lengths.
 */

describe("closest figure curve", () => {
  it("awards full points for an exact count", () => {
    expect(closestFigureScore(286, 286)).toBe(100);
    expect(closestFigureScore(3, 3)).toBe(100);
  });

  it("scales with relative error, not absolute distance", () => {
    // The core property. Ten ayahs out is an excellent guess on Al-Baqarah and
    // a wild miss on Al-Kawthar; one curve has to express both.
    const onBaqarah = closestFigureScore(276, 286);
    const onKawthar = closestFigureScore(13, 3);
    expect(onBaqarah).toBeGreaterThanOrEqual(90);
    expect(onKawthar).toBe(0);
  });

  it("keeps short Surahs playable via the tolerance floor", () => {
    // Pure relative error would make one ayah out on a 3-ayah Surah a 33%
    // error and score near zero, which reads as arbitrary rather than hard.
    expect(closestFigureScore(4, 3)).toBeGreaterThan(40);
    expect(closestFigureScore(2, 3)).toBeGreaterThan(40);
  });

  it("falls monotonically as the guess drifts", () => {
    const actual = 50;
    let previous = closestFigureScore(actual, actual);
    for (let distance = 1; distance <= 30; distance += 1) {
      const score = closestFigureScore(actual + distance, actual);
      expect(score).toBeLessThanOrEqual(previous);
      previous = score;
    }
  });

  it("is symmetric above and below the true count", () => {
    // Guessing 10 under must be worth exactly what guessing 10 over is worth.
    for (const actual of [7, 30, 114, 286]) {
      expect(closestFigureScore(actual - 5, actual)).toBe(closestFigureScore(actual + 5, actual));
    }
  });

  it("floors at zero rather than going negative", () => {
    expect(closestFigureScore(300, 3)).toBe(0);
    expect(closestFigureScore(1, 286)).toBe(0);
    // A hopeless guess costs a try and nothing more.
    expect(closestFigureScore(-50, 30)).toBe(0);
  });

  it("punishes a fixed guess repeated across the Quran", () => {
    // Typing 150 every round should not be a viable strategy. Across a spread
    // of real Surah lengths it must average poorly.
    const lengths = [7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99];
    const total = lengths.reduce((sum, actual) => sum + closestFigureScore(150, actual), 0);
    // ~24 per round, so roughly 168 out of a possible 700 across an attempt.
    // Low enough that the strategy is not viable, without being a flat zero
    // that would make the mode feel punitive to a beginner.
    expect(total / lengths.length).toBeLessThan(25);
  });

  it("rewards genuine convergence", () => {
    // A player narrowing in should see the score climb meaningfully.
    const actual = 78;
    expect(closestFigureScore(120, actual)).toBeLessThan(20);
    expect(closestFigureScore(90, actual)).toBeGreaterThan(45);
    expect(closestFigureScore(80, actual)).toBeGreaterThan(85);
  });

  it("handles degenerate input without throwing", () => {
    expect(closestFigureScore(Number.NaN, 30)).toBe(0);
    expect(closestFigureScore(30, 0)).toBe(0);
    expect(closestFigureScore(30, Number.NaN)).toBe(0);
  });
});

describe("closest figure round score", () => {
  it("takes the best guess, not the average", () => {
    // Averaging would punish a player for guessing again after nailing it on
    // try 1, making "re-enter the same number" the optimal play.
    expect(closestFigureRoundScore([100, 0, 0, 0, 0])).toBe(100 - TRY_PENALTY * 4);
  });

  it("charges a gentle penalty per extra try", () => {
    expect(closestFigureRoundScore([100])).toBe(100);
    expect(closestFigureRoundScore([40, 100])).toBe(95);
    expect(closestFigureRoundScore([10, 40, 100])).toBe(90);
  });

  it("never returns a negative round score", () => {
    expect(closestFigureRoundScore([0, 0, 0, 0, 0])).toBe(0);
  });

  it("returns zero for a round with no guesses", () => {
    expect(closestFigureRoundScore([])).toBe(0);
  });

  it("matches the advertised ceiling for the tries spent", () => {
    expect(closestFigureCeiling(0)).toBe(100);
    expect(closestFigureCeiling(2)).toBe(90);
    expect(closestFigureCeiling(5)).toBe(75);
  });
});

describe("directional feedback", () => {
  it("points toward the real count without revealing distance", () => {
    expect(guessDirection(40, 78)).toBe("higher");
    expect(guessDirection(90, 78)).toBe("lower");
    expect(guessDirection(78, 78)).toBe("exact");
  });
});

describe("exact figure", () => {
  it("reuses the base ladder", () => {
    expect([0, 1, 2, 3, 4].map(exactFigureScore)).toEqual([100, 80, 60, 40, 20]);
  });

  it("floors a final-try correct answer at 20", () => {
    expect(exactFigureScore(5)).toBe(20);
  });
});

describe("input validation", () => {
  it("accepts plausible ayah counts only", () => {
    expect(isValidAyahGuess(1)).toBe(true);
    expect(isValidAyahGuess(286)).toBe(true);
    expect(isValidAyahGuess(MAX_AYAH_GUESS)).toBe(true);
    expect(isValidAyahGuess(0)).toBe(false);
    expect(isValidAyahGuess(301)).toBe(false);
    expect(isValidAyahGuess(7.5)).toBe(false);
    expect(isValidAyahGuess("seven")).toBe(false);
    expect(isValidAyahGuess(null)).toBe(false);
  });

  it("recognises the two variants", () => {
    expect(isAyahCountVariant("exact")).toBe(true);
    expect(isAyahCountVariant("closest")).toBe(true);
    expect(isAyahCountVariant("nearest")).toBe(false);
  });
});

describe("mode registry", () => {
  it("describes every mode in play order", () => {
    // Registry order is the order the Modes menu offers them, so this asserts
    // the running order rather than merely which modes exist.
    expect(GAME_MODES.map((mode) => mode.id)).toEqual([
      "identify-surah",
      "completion",
      "ayah-counts",
    ]);
  });

  it("falls back to the default for an unknown mode", () => {
    // A crafted request or a stale saved preference should land the player in
    // the default game, not break the board.
    expect(getMode("nonsense").id).toBe("identify-surah");
    expect(getMode(undefined).id).toBe("identify-surah");
    expect(isModeId("ayah-counts")).toBe(true);
    expect(isModeId("completion")).toBe(true);
    expect(isModeId("chess")).toBe(false);
  });

  it("turns off audio and hints for Ayah Counts", () => {
    // The Surah is visible, so audio conceals nothing and every hint either
    // names the Surah or gives away the count.
    const mode = getMode("ayah-counts");
    expect(mode.hasAudio).toBe(false);
    expect(mode.hasHints).toBe(false);
  });

  it("resolves variants with a default", () => {
    const mode = getMode("ayah-counts");
    expect(getVariant(mode, "closest")?.id).toBe("closest");
    expect(getVariant(mode, "bogus")?.id).toBe("exact");
    expect(getVariant(getMode("identify-surah"), "exact")).toBeNull();
  });
});

describe("rule card examples", () => {
  it("derives the worked example from the real curve", () => {
    // Shown to the player, so it must come from the scorer rather than being
    // written out by hand where it could drift.
    const examples = closestFigureExamples(30);
    expect(examples[0]).toEqual({ distance: 0, guess: 30, points: 100 });
    for (const example of examples) {
      expect(example.points).toBe(closestFigureScore(example.guess, 30));
    }
  });
});
