import { isModeId, type ModeId } from "./modes";
import {
  MAX_ATTEMPT_HINTS,
  MAX_ATTEMPT_ROUNDS,
  type HintType,
  hintsRemaining,
  isAttemptComplete,
  isHintType,
  nextHintCost,
} from "./rules";

/**
 * Attempt state as a plain, JSON-serializable record, plus the pure transitions
 * that act on it.
 *
 * The previous version used `Map` and `Set` inside the state object and mutated
 * it in place in a module-level Map. That shape cannot round-trip through Redis
 * — `JSON.stringify(new Set())` is `{}` — so the storage backend and the game
 * rules were welded together. Here the record is ordinary JSON and every
 * transition is a function over it, which means the rules can be tested with no
 * store at all and the store can be swapped with no rule changes.
 *
 * Transitions mutate the record they are handed and let the caller persist it.
 * The caller always holds the store lock for that attempt, so the mutation is
 * not observable until it is written back.
 */

export const ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;

export type RoundRecord = {
  revision: number;
  finished: boolean;
  /** Hint types already revealed in this round, as an array so it serializes. */
  revealedHints: HintType[];
};

export type ShareRoundState = "perfect" | "close" | "missed" | "skipped";

export type AttemptShareStats = {
  totalScore: number;
  roundsWon: number;
  currentStreak: number;
  bestStreak: number;
  exact: number;
  firstTryWins: number;
  proximityTotal: number;
  proximityRounds: number;
  roundStates: ShareRoundState[];
};

export type AttemptRecord = {
  id: string;
  createdAt: number;
  /** Game rules are fixed for the lifetime of an attempt. */
  mode?: ModeId;
  variant?: string;
  hintsUsed: number;
  roundsCompleted: number;
  rounds: Record<string, RoundRecord>;
  /** Spoiler-free, server-authoritative stats used only for public result sharing. */
  shareStats: AttemptShareStats;
};

export type HintStatus = {
  hintsUsed: number;
  hintsRemaining: number;
  nextHintCost: number | null;
};

/** Thrown for rule violations the player can see and act on. */
export class AttemptRuleError extends Error {
  readonly kind: "conflict" | "bad_request";

  constructor(message: string, kind: "conflict" | "bad_request" = "conflict") {
    super(message);
    this.name = "AttemptRuleError";
    this.kind = kind;
  }
}

export function emptyAttemptShareStats(): AttemptShareStats {
  return {
    totalScore: 0,
    roundsWon: 0,
    currentStreak: 0,
    bestStreak: 0,
    exact: 0,
    firstTryWins: 0,
    proximityTotal: 0,
    proximityRounds: 0,
    roundStates: [],
  };
}

export function newAttemptRecord(id: string, now = Date.now()): AttemptRecord {
  return {
    id,
    createdAt: now,
    hintsUsed: 0,
    roundsCompleted: 0,
    rounds: {},
    shareStats: emptyAttemptShareStats(),
  };
}

/**
 * Recover a usable record from whatever the store returned.
 *
 * Anything read back could be from an older deploy with a different shape, or
 * truncated. Coercing field by field means a schema change ages out gracefully
 * instead of throwing on every request until the TTL expires.
 */
export function reviveAttemptRecord(value: unknown): AttemptRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<AttemptRecord>;
  if (typeof record.id !== "string" || !record.id) return null;

  const rounds: Record<string, RoundRecord> = {};
  if (record.rounds && typeof record.rounds === "object") {
    for (const [roundId, round] of Object.entries(record.rounds)) {
      if (!round || typeof round !== "object") continue;
      const candidate = round as Partial<RoundRecord>;
      rounds[roundId] = {
        revision: clampCount(candidate.revision, Number.MAX_SAFE_INTEGER),
        finished: candidate.finished === true,
        revealedHints: Array.isArray(candidate.revealedHints)
          ? candidate.revealedHints.filter(isHintType)
          : [],
      };
    }
  }

  const rawShare = record.shareStats && typeof record.shareStats === "object"
    ? record.shareStats as Partial<AttemptShareStats>
    : {};
  const allowedStates = new Set<ShareRoundState>(["perfect", "close", "missed", "skipped"]);
  const roundStates = Array.isArray(rawShare.roundStates)
    ? rawShare.roundStates.filter((state): state is ShareRoundState => allowedStates.has(state as ShareRoundState)).slice(0, MAX_ATTEMPT_ROUNDS)
    : [];

  const revived: AttemptRecord = {
    id: record.id,
    createdAt: Number(record.createdAt) > 0 ? Number(record.createdAt) : Date.now(),
    hintsUsed: clampCount(record.hintsUsed, MAX_ATTEMPT_HINTS),
    roundsCompleted: clampCount(record.roundsCompleted, MAX_ATTEMPT_ROUNDS),
    rounds,
    shareStats: {
      totalScore: clampCount(rawShare.totalScore, MAX_ATTEMPT_ROUNDS * 100),
      roundsWon: clampCount(rawShare.roundsWon, MAX_ATTEMPT_ROUNDS),
      currentStreak: clampCount(rawShare.currentStreak, MAX_ATTEMPT_ROUNDS),
      bestStreak: clampCount(rawShare.bestStreak, MAX_ATTEMPT_ROUNDS),
      exact: clampCount(rawShare.exact, MAX_ATTEMPT_ROUNDS),
      firstTryWins: clampCount(rawShare.firstTryWins, MAX_ATTEMPT_ROUNDS),
      proximityTotal: clampCount(rawShare.proximityTotal, MAX_ATTEMPT_ROUNDS * 100),
      proximityRounds: clampCount(rawShare.proximityRounds, MAX_ATTEMPT_ROUNDS),
      roundStates,
    },
  };

  if (isModeId(record.mode)) revived.mode = record.mode;
  if (typeof record.variant === "string" && record.variant) revived.variant = record.variant;
  return revived;
}

export function registerRound(attempt: AttemptRecord, roundId: string) {
  if (isAttemptComplete(attempt.roundsCompleted)) {
    throw new AttemptRuleError("This seven-round attempt is complete. Start a new attempt to keep playing.");
  }
  attempt.rounds[roundId] = { revision: 0, finished: false, revealedHints: [] };
  pruneFinishedRounds(attempt);
  return { roundId, revision: 0 };
}

export function assertRoundActive(attempt: AttemptRecord, roundId: string, revision: number) {
  const round = attempt.rounds[roundId];
  if (!round || round.finished) {
    throw new AttemptRuleError("This round is no longer active. Start the next round.");
  }
  if (round.revision !== revision) {
    throw new AttemptRuleError("This round action used stale state. Refresh the current round and try again.");
  }
  return round;
}

export function rotateRoundRevision(attempt: AttemptRecord, roundId: string, revision: number) {
  const round = assertRoundActive(attempt, roundId, revision);
  round.revision += 1;
  return round.revision;
}

export function finishRound(attempt: AttemptRecord, roundId: string, revision: number) {
  const round = assertRoundActive(attempt, roundId, revision);
  round.finished = true;
  round.revision += 1;
  attempt.roundsCompleted = Math.min(MAX_ATTEMPT_ROUNDS, attempt.roundsCompleted + 1);
  return attempt.roundsCompleted;
}


export type RecordShareRoundInput = {
  points: number;
  correct: boolean;
  skipped?: boolean;
  /** Number of wrong/skip tries already spent before a successful answer. */
  attemptsUsedBeforeSuccess?: number;
  /** Ayah Counts: whether the final answer landed exactly on the count. */
  exact?: boolean;
  /** Closest Figure: 0–100 best raw proximity for this round. */
  proximity?: number;
};

/**
 * Record only public-safe aggregate information for sharing.
 *
 * No chapter id, verse key, answer, prompt text, expected completion, or
 * sequence order is accepted by this function. Keeping the input intentionally
 * narrow makes accidental spoiler leakage difficult when new game modes are
 * added later.
 */
export function recordShareRoundResult(
  attempt: AttemptRecord,
  input: RecordShareRoundInput,
) {
  const stats = attempt.shareStats;
  const points = clampCount(input.points, 100);
  const won = input.correct === true;
  const skipped = input.skipped === true;

  stats.totalScore = Math.min(MAX_ATTEMPT_ROUNDS * 100, stats.totalScore + points);

  if (won) {
    stats.roundsWon = Math.min(MAX_ATTEMPT_ROUNDS, stats.roundsWon + 1);
    stats.currentStreak = Math.min(MAX_ATTEMPT_ROUNDS, stats.currentStreak + 1);
    stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
    if ((input.attemptsUsedBeforeSuccess ?? 0) === 0) {
      stats.firstTryWins = Math.min(MAX_ATTEMPT_ROUNDS, stats.firstTryWins + 1);
    }
  } else {
    stats.currentStreak = 0;
  }

  if (input.exact) {
    stats.exact = Math.min(MAX_ATTEMPT_ROUNDS, stats.exact + 1);
  }

  if (Number.isFinite(input.proximity)) {
    stats.proximityTotal = Math.min(
      MAX_ATTEMPT_ROUNDS * 100,
      stats.proximityTotal + clampCount(input.proximity, 100),
    );
    stats.proximityRounds = Math.min(MAX_ATTEMPT_ROUNDS, stats.proximityRounds + 1);
  }

  const state: ShareRoundState = skipped
    ? "skipped"
    : won && points >= 100
      ? "perfect"
      : won || points > 0
        ? "close"
        : "missed";

  if (stats.roundStates.length < MAX_ATTEMPT_ROUNDS) {
    stats.roundStates.push(state);
  }
}

export function hintStatus(attempt: AttemptRecord): HintStatus {
  return {
    hintsUsed: attempt.hintsUsed,
    hintsRemaining: hintsRemaining(attempt.hintsUsed),
    nextHintCost: nextHintCost(attempt.hintsUsed),
  };
}

export function consumeHint(
  attempt: AttemptRecord,
  roundId: string,
  revision: number,
  hintType: HintType,
) {
  const round = assertRoundActive(attempt, roundId, revision);
  if (!isHintType(hintType)) {
    throw new AttemptRuleError("That hint type is not available.", "bad_request");
  }
  if (attempt.hintsUsed >= MAX_ATTEMPT_HINTS) {
    throw new AttemptRuleError("Both hints for this seven-round attempt have already been used.");
  }
  if (round.revealedHints.includes(hintType)) {
    throw new AttemptRuleError("That hint has already been revealed for this round. Choose a different hint type.");
  }

  const cost = nextHintCost(attempt.hintsUsed) ?? 0;
  attempt.hintsUsed += 1;
  round.revealedHints.push(hintType);
  round.revision += 1;

  return { cost, revision: round.revision, ...hintStatus(attempt) };
}

export function canStartNewAttempt(attempt: AttemptRecord | null) {
  return !attempt || isAttemptComplete(attempt.roundsCompleted);
}

/** Server-authoritative progress, echoed to the client so it can reconcile. */
export function attemptProgress(attempt: AttemptRecord) {
  return {
    roundsCompleted: attempt.roundsCompleted,
    roundsRemaining: Math.max(0, MAX_ATTEMPT_ROUNDS - attempt.roundsCompleted),
    complete: isAttemptComplete(attempt.roundsCompleted),
  };
}

/**
 * Keep only the rounds still needed for replay checks.
 *
 * Finished rounds are retained briefly so a duplicate submission gets "this
 * round is over" rather than "unknown round", but an attempt never needs more
 * than a handful, and unbounded growth would bloat every store write.
 */
function pruneFinishedRounds(attempt: AttemptRecord, keep = MAX_ATTEMPT_ROUNDS * 2) {
  const ids = Object.keys(attempt.rounds);
  if (ids.length <= keep) return;
  for (const id of ids.slice(0, ids.length - keep)) {
    if (attempt.rounds[id]?.finished) delete attempt.rounds[id];
  }
}

function clampCount(value: unknown, max: number) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.min(max, Math.floor(count));
}
