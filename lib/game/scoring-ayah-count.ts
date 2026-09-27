import { MAX_TRIES_PER_ROUND, POINTS_LOST_PER_TRY, STARTING_POINTS } from "./rules";

/**
 * Scoring for the Ayah Counts mode.
 *
 * Two sub-modes share a round shape (7 rounds, 5 tries) but score differently:
 *
 * - Exact Figure reuses the base game's ladder: 100/80/60/40/20 by try.
 * - Closest Figure weights each guess by how close it came, so a near miss is
 *   worth most of the points and a wild stab is worth almost none.
 *
 * Everything here is a pure function of numbers. No Next, no React, no store —
 * which is what makes the curve directly testable and lets the client render a
 * live score preview from the same code the server scores with.
 */

/**
 * Shape of the falloff. 1 is linear; higher is stricter near the edges.
 *
 * Linear proved too generous: a player who types 150 every round lands within
 * tolerance often enough to score respectably without engaging. 1.5 keeps
 * near-misses feeling rewarded while pushing vague guesses toward zero.
 */
const FALLOFF_EXPONENT = 1.5;

/**
 * Tolerance is proportional to the Surah's own length, not a fixed number of
 * ayahs.
 *
 * Surahs run from 3 ayahs to 286, so a fixed penalty per ayah cannot be right
 * for both ends: being 10 out on Al-Kawthar is a wild miss, being 10 out on
 * Al-Baqarah is an excellent guess. Scoring on relative error expresses both
 * with one curve.
 */
const TOLERANCE_RATIO = 0.5;

/**
 * Floor on the tolerance window.
 *
 * Pure relative error is brutal on short Surahs — one ayah out on a 3-ayah
 * Surah is a 33% error and would score near zero, which makes the shortest
 * Surahs feel arbitrary rather than hard. A minimum window keeps the mode
 * playable across the whole Quran.
 */
const MIN_TOLERANCE = 3;

/** Largest count a player may enter. Al-Baqarah is 286. */
export const MAX_AYAH_GUESS = 300;

export type AyahCountVariant = "exact" | "closest";

export const AYAH_COUNT_VARIANTS: readonly AyahCountVariant[] = ["exact", "closest"];

export function isAyahCountVariant(value: unknown): value is AyahCountVariant {
  return value === "exact" || value === "closest";
}

export function isValidAyahGuess(value: unknown): value is number {
  const guess = Number(value);
  return Number.isInteger(guess) && guess >= 1 && guess <= MAX_AYAH_GUESS;
}

/**
 * Points for a single Closest Figure guess, 0–100.
 *
 * An exact hit is 100. Beyond the tolerance window the score is 0 rather than
 * negative, so a hopeless guess costs nothing more than a wasted try.
 */
export function closestFigureScore(guess: number, actual: number) {
  if (!Number.isFinite(guess) || !Number.isFinite(actual) || actual <= 0) return 0;

  const distance = Math.abs(guess - actual);
  if (distance === 0) return STARTING_POINTS;

  const tolerance = Math.max(MIN_TOLERANCE, actual * TOLERANCE_RATIO);
  const error = distance / tolerance;
  if (error >= 1) return 0;

  return Math.round(STARTING_POINTS * Math.pow(1 - error, FALLOFF_EXPONENT));
}

/**
 * Directional feedback after a Closest Figure guess.
 *
 * Without this the five tries are five independent stabs; with it they become
 * a convergence game, which is the version worth playing. It leaks only the
 * direction, never the distance, so the player still has to judge the step.
 */
export type GuessDirection = "higher" | "lower" | "exact";

export function guessDirection(guess: number, actual: number): GuessDirection {
  if (guess === actual) return "exact";
  return guess < actual ? "higher" : "lower";
}

/**
 * Final score for a Closest Figure round.
 *
 * Best guess, minus a penalty for each try beyond the first.
 *
 * Averaging the tries was the original proposal and it has a perverse
 * incentive: a player who nails the count on try 1 is then punished for every
 * further guess, so the optimal play is to re-enter the same number four times
 * to protect the average. Best-of removes that, and the per-try penalty keeps
 * the "answer sooner for more points" principle the base game already
 * establishes — so both modes reward the same behaviour.
 */
export function closestFigureRoundScore(tryScores: readonly number[]) {
  if (!tryScores.length) return 0;
  const best = Math.max(...tryScores);
  const penalty = TRY_PENALTY * (Math.min(tryScores.length, MAX_TRIES_PER_ROUND) - 1);
  return Math.max(0, best - penalty);
}

/**
 * Cost of each try after the first, in Closest Figure.
 *
 * Deliberately gentler than the base game's 20. There a wrong guess is simply
 * wrong; here every guess still earns its weighted score, so a steep penalty
 * would double-punish a player who is converging correctly.
 */
export const TRY_PENALTY = 5;

/** Best achievable score given the tries already spent. */
export function closestFigureCeiling(triesUsed: number) {
  const used = Math.max(0, Math.min(MAX_TRIES_PER_ROUND, Math.floor(triesUsed)));
  return Math.max(0, STARTING_POINTS - TRY_PENALTY * used);
}

/**
 * Exact Figure reuses the base ladder verbatim.
 *
 * Re-exported through this module so the mode has one scoring entry point and
 * a future change to either variant does not have to reach into rules.ts.
 */
export function exactFigureScore(triesUsed: number) {
  const used = Math.max(0, Math.min(MAX_TRIES_PER_ROUND, Math.floor(triesUsed)));
  return Math.max(20, STARTING_POINTS - used * POINTS_LOST_PER_TRY);
}

/**
 * A worked sample of the curve, for the rule card.
 *
 * Generated rather than written out so the numbers shown to the player cannot
 * drift from the numbers the server awards.
 */
export function closestFigureExamples(actual = 30) {
  return [0, 2, 5, 10, 20].map((distance) => ({
    distance,
    guess: actual + distance,
    points: closestFigureScore(actual + distance, actual),
  }));
}
