import { MAX_ATTEMPT_ROUNDS, MAX_TRIES_PER_ROUND } from "./rules";

/**
 * Registry of playable game modes.
 *
 * Modes are described as data rather than expressed as branches scattered
 * through the routes and the component. Adding a mode means adding an entry
 * here plus a round builder and a scorer — not editing the nav, the rule card,
 * the round route, the guess route, and the client in five separate places.
 *
 * `answerKind` is the important field: it tells every layer what the player is
 * being asked for, which is what decides whether the board renders an audio
 * player and a Surah search, or a Surah name and a number input.
 */

export type ModeId = "identify-surah" | "ayah-counts" | "completion";

export type AnswerKind = "surah" | "ayah-count" | "completion";

export type ModeVariant = {
  id: string;
  name: string;
  tagline: string;
};

export type GameMode = {
  id: ModeId;
  name: string;
  /** One line, shown in the Modes dropdown. */
  tagline: string;
  answerKind: AnswerKind;
  /** Whether the round carries recitation audio and word timing. */
  hasAudio: boolean;
  /** Whether the attempt-wide hint allowance applies. */
  hasHints: boolean;
  rounds: number;
  triesPerRound: number;
  variants?: readonly ModeVariant[];
  defaultVariant?: string;
};

export const GAME_MODES: readonly GameMode[] = [
  {
    id: "identify-surah",
    name: "Identify the Surah",
    tagline: "Hear a complete Ayah and name the Surah it comes from.",
    answerKind: "surah",
    hasAudio: true,
    hasHints: true,
    rounds: MAX_ATTEMPT_ROUNDS,
    triesPerRound: MAX_TRIES_PER_ROUND,
  },
  {
    id: "completion",
    name: "Completion",
    tagline: "Complete the passage by choosing the Ayah that comes next.",
    answerKind: "completion",
    hasAudio: true,
    hasHints: false,
    rounds: MAX_ATTEMPT_ROUNDS,
    triesPerRound: MAX_TRIES_PER_ROUND,
    variants: [
      {
        id: "fill-in",
        name: "Fill-in",
        tagline: "Choose the single Ayah that correctly continues the passage.",
      },
      {
        id: "sequence",
        name: "Sequence",
        tagline: "Arrange the proceeding Ayahs in their correct order.",
      },
    ],
    defaultVariant: "fill-in",
  },
  {
    id: "ayah-counts",
    name: "Ayah Counts",
    tagline: "See a Surah and work out how many Ayahs it holds.",
    answerKind: "ayah-count",
    // The Surah is shown, so there is nothing for audio to conceal — playing a
    // recitation here would be decoration, and word-timing would be dead
    // weight in the payload.
    hasAudio: false,
    // Every current hint either names the Surah or reveals the Ayah count
    // outright, so the allowance has no meaning in a mode where the Surah is
    // visible and the count is the answer.
    hasHints: false,
    rounds: MAX_ATTEMPT_ROUNDS,
    triesPerRound: MAX_TRIES_PER_ROUND,
    variants: [
      {
        id: "exact",
        name: "Exact Figure",
        tagline: "Name the exact count. Same 100/80/60/40/20 ladder.",
      },
      {
        id: "closest",
        name: "Closest Figure",
        tagline: "Every guess scores by how close it lands.",
      },
    ],
    defaultVariant: "exact",
  },
];

export const DEFAULT_MODE_ID: ModeId = "identify-surah";

const MODE_BY_ID = new Map(GAME_MODES.map((mode) => [mode.id, mode]));

export function isModeId(value: unknown): value is ModeId {
  return typeof value === "string" && MODE_BY_ID.has(value as ModeId);
}

export function getMode(id: unknown): GameMode {
  // Falls back rather than throwing: an unknown mode in a saved preference or
  // a crafted request should drop the player into the default game, not break
  // the board.
  return MODE_BY_ID.get(id as ModeId) ?? MODE_BY_ID.get(DEFAULT_MODE_ID)!;
}

/** Resolve a variant id against a mode, falling back to its default. */
export function getVariant(mode: GameMode, variantId: unknown) {
  if (!mode.variants?.length) return null;
  const found = mode.variants.find((variant) => variant.id === variantId);
  return found ?? mode.variants.find((variant) => variant.id === mode.defaultVariant) ?? mode.variants[0];
}
