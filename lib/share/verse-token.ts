import "server-only";

import crypto from "node:crypto";
import { roundTokenSecret } from "@/lib/config/env";
import { isShareVersePayload, type ShareVersePayload } from "./verse-types";

export const SHARE_VERSE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export class ShareVerseTokenError extends Error {
  constructor(message = "This SurahSpot verse link is invalid or has expired.") {
    super(message);
    this.name = "ShareVerseTokenError";
  }
}

function signingKey() {
  return crypto.createHmac("sha256", roundTokenSecret()).update("surahspot:share-verse:v1").digest();
}

function signature(encoded: string) {
  return crypto.createHmac("sha256", signingKey()).update(encoded).digest("base64url");
}

export function sealShareVerse(payload: ShareVersePayload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function openShareVerse(token: string, now = Date.now()): ShareVersePayload {
  try {
    const [encoded, suppliedSignature, extra] = token.split(".");
    if (!encoded || !suppliedSignature || extra) throw new ShareVerseTokenError();
    const expected = signature(encoded);
    const supplied = Buffer.from(suppliedSignature);
    const expectedBuffer = Buffer.from(expected);
    if (supplied.length !== expectedBuffer.length || !crypto.timingSafeEqual(supplied, expectedBuffer)) {
      throw new ShareVerseTokenError();
    }
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    if (!isShareVersePayload(payload)) throw new ShareVerseTokenError();
    if (now < payload.createdAt - 5 * 60 * 1000 || now - payload.createdAt > SHARE_VERSE_TTL_MS) {
      throw new ShareVerseTokenError();
    }
    return payload;
  } catch (error) {
    if (error instanceof ShareVerseTokenError) throw error;
    throw new ShareVerseTokenError();
  }
}
