import type { ModeId } from "@/lib/game/modes";
import type { ShareRoundState } from "@/lib/game/attempt";

/**
 * The only game-result data SurahSpot is allowed to publish.
 *
 * Deliberately absent: chapter ids, Surah names, verse keys/text, guesses,
 * answers, expected completion ids and sequence order. Public share tokens are
 * built from this type so adding a future game mode cannot accidentally expose
 * private round state unless this contract is explicitly expanded.
 */
export type ShareResultPayload = {
  version: 1;
  mode: ModeId;
  variant?: string;
  score: number;
  roundsPlayed: number;
  roundsWon: number;
  bestStreak: number;
  exact: number;
  firstTryWins: number;
  averageProximity?: number;
  roundStates: ShareRoundState[];
  createdAt: number;
};

export function isShareResultPayload(value: unknown): value is ShareResultPayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ShareResultPayload>;
  const modes: ModeId[] = ["identify-surah", "ayah-counts", "completion"];
  const states: ShareRoundState[] = ["perfect", "close", "missed", "skipped"];
  return Boolean(
    item.version === 1 &&
    typeof item.mode === "string" && modes.includes(item.mode as ModeId) &&
    (item.variant === undefined || typeof item.variant === "string") &&
    Number.isInteger(item.score) && (item.score ?? -1) >= 0 && (item.score ?? 701) <= 700 &&
    Number.isInteger(item.roundsPlayed) && (item.roundsPlayed ?? -1) >= 0 && (item.roundsPlayed ?? 8) <= 7 &&
    Number.isInteger(item.roundsWon) && (item.roundsWon ?? -1) >= 0 && (item.roundsWon ?? 8) <= 7 &&
    Number.isInteger(item.bestStreak) && (item.bestStreak ?? -1) >= 0 && (item.bestStreak ?? 8) <= 7 &&
    Number.isInteger(item.exact) && (item.exact ?? -1) >= 0 && (item.exact ?? 8) <= 7 &&
    Number.isInteger(item.firstTryWins) && (item.firstTryWins ?? -1) >= 0 && (item.firstTryWins ?? 8) <= 7 &&
    (item.averageProximity === undefined || (Number.isInteger(item.averageProximity) && item.averageProximity >= 0 && item.averageProximity <= 100)) &&
    Array.isArray(item.roundStates) && item.roundStates.length <= 7 && item.roundStates.every((state) => states.includes(state)) &&
    Number.isFinite(item.createdAt) && (item.createdAt ?? 0) > 0
  );
}
