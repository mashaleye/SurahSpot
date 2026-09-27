import crypto from "node:crypto";
import { roundTokenSecret } from "@/lib/config/env";

/**
 * The round token is the whole anti-cheat model in one object.
 *
 * It carries the answer (chapterId, verseKey), the audio URL the proxy will
 * fetch, the scoring state so far, and the attempt/round/revision triple that
 * ties it to server-side state. It is AES-256-GCM sealed, so the browser holds
 * an opaque blob it can neither read nor forge, and every mutation returns a
 * freshly sealed token at a new revision — which is what makes a saved
 * pre-hint token useless for dodging the second-hint cost.
 *
 * Kept separate from the HTTP client so the crypto can be tested on its own,
 * and so a future change of token format touches one file.
 */

export type RoundPayload = {
  chapterId: number;
  attemptsUsed: number;
  hintPenalty: number;
  attemptId: string;
  roundId: string;
  revision: number;
  issuedAt: number;

  /**
   * Which game the token belongs to.
   *
   * Optional so tokens minted before modes existed still open — they predate
   * the field and are all Identify-the-Surah by definition. A token is only
   * accepted by the route for its own mode, so this is also what stops an
   * Ayah-Counts token being replayed against the Surah guess endpoint.
   */
  mode?: string;
  variant?: string;

  // --- Identify the Surah ---------------------------------------------------
  // Absent in modes that show the Surah and play no audio.
  verseKey?: string;
  reciterId?: number;
  audioUrl?: string;

  // --- Ayah Counts ----------------------------------------------------------
  /** The answer. Sealed, so the browser never sees the count it is guessing. */
  versesCount?: number;
  /**
   * Per-try scores so far, for Closest Figure.
   *
   * Carried in the token rather than in attempt state because it is round-local
   * and already protected: the token is sealed and its revision rotates on
   * every mutation, so a player cannot replay an earlier, better set of scores.
   */
  tryScores?: number[];

  // --- Completion -----------------------------------------------------------
  /** Ordered answer ids. Fill-in has one; Sequence has one id per blank slot. */
  completionCorrectChoiceIds?: string[];
  /** Prompt keys are sealed so translation switching can re-fetch only shown Ayahs. */
  completionPromptVerseKeys?: string[];
  /** Target keys are sealed for reveal/translation without exposing their order in the client payload. */
  completionTargetVerseKeys?: string[];
};

const IV_BYTES = 12;
const TAG_BYTES = 16;
export const ROUND_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export class RoundTokenError extends Error {
  /** Read structurally by the HTTP layer, which maps it to 400. */
  readonly kind = "bad_request" as const;

  constructor(message = "This round token is invalid or expired. Start a new round.") {
    super(message);
    this.name = "RoundTokenError";
  }
}

function encryptionKey() {
  return crypto.createHash("sha256").update(roundTokenSecret()).digest();
}

export function sealRound(payload: RoundPayload) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function openRound(token: string, now = Date.now()): RoundPayload {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES) throw new RoundTokenError();

    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const encrypted = raw.subarray(IV_BYTES + TAG_BYTES);

    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    const payload = JSON.parse(decrypted) as RoundPayload;

    if (!isCompletePayload(payload)) throw new RoundTokenError();
    if (!payload.issuedAt || now - payload.issuedAt > ROUND_TOKEN_TTL_MS) throw new RoundTokenError();
    return payload;
  } catch (error) {
    // Deliberately uniform: distinguishing "bad signature" from "expired" from
    // "malformed" would tell someone probing the endpoint which part of a
    // forged token they got right.
    if (error instanceof RoundTokenError) throw error;
    throw new RoundTokenError();
  }
}

function isCompletePayload(payload: RoundPayload) {
  const commonFieldsPresent = Boolean(
    payload &&
    Number.isInteger(payload.chapterId) && payload.chapterId >= 1 && payload.chapterId <= 114 &&
    typeof payload.attemptsUsed === "number" &&
    typeof payload.hintPenalty === "number" &&
    typeof payload.attemptId === "string" && payload.attemptId &&
    typeof payload.roundId === "string" && payload.roundId &&
    typeof payload.revision === "number",
  );
  if (!commonFieldsPresent) return false;

  // Mode-specific fields. Validated per mode rather than as one flat list,
  // because requiring audioUrl everywhere would reject every Ayah Counts token
  // and requiring nothing would let a malformed token reach the audio proxy.
  if (payload.mode === "ayah-counts") {
    return Number.isInteger(payload.versesCount) && (payload.versesCount ?? 0) > 0;
  }

  if (payload.mode === "completion") {
    return Boolean(
      typeof payload.verseKey === "string" && payload.verseKey &&
      Number.isFinite(payload.reciterId) &&
      typeof payload.audioUrl === "string" && payload.audioUrl &&
      Array.isArray(payload.completionCorrectChoiceIds) && payload.completionCorrectChoiceIds.length >= 1 &&
      payload.completionCorrectChoiceIds.every((id) => typeof id === "string" && id.length > 0) &&
      Array.isArray(payload.completionPromptVerseKeys) && payload.completionPromptVerseKeys.length >= 1 &&
      payload.completionPromptVerseKeys.every((key) => typeof key === "string" && key.length > 0) &&
      Array.isArray(payload.completionTargetVerseKeys) && payload.completionTargetVerseKeys.length >= 1 &&
      payload.completionTargetVerseKeys.every((key) => typeof key === "string" && key.length > 0)
    );
  }

  return Boolean(
    typeof payload.verseKey === "string" && payload.verseKey &&
    Number.isFinite(payload.reciterId) &&
    typeof payload.audioUrl === "string" && payload.audioUrl,
  );
}
