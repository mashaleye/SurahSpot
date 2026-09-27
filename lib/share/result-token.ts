import "server-only";

import crypto from "node:crypto";
import { roundTokenSecret } from "@/lib/config/env";
import { isShareResultPayload, type ShareResultPayload } from "./result-types";

export const SHARE_RESULT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export class ShareResultTokenError extends Error {
  constructor(message = "This SurahSpot result link is invalid or has expired.") {
    super(message);
    this.name = "ShareResultTokenError";
  }
}

function signingKey() {
  // Domain-separate public share signatures from private encrypted round tokens
  // even when deployments use the same root secret.
  return crypto.createHmac("sha256", roundTokenSecret()).update("surahspot:share-result:v1").digest();
}

function signature(encoded: string) {
  return crypto.createHmac("sha256", signingKey()).update(encoded).digest("base64url");
}

export function sealShareResult(payload: ShareResultPayload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function openShareResult(token: string, now = Date.now()): ShareResultPayload {
  try {
    const [encoded, suppliedSignature, extra] = token.split(".");
    if (!encoded || !suppliedSignature || extra) throw new ShareResultTokenError();
    const expected = signature(encoded);
    const supplied = Buffer.from(suppliedSignature);
    const expectedBuffer = Buffer.from(expected);
    if (supplied.length !== expectedBuffer.length || !crypto.timingSafeEqual(supplied, expectedBuffer)) {
      throw new ShareResultTokenError();
    }
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    if (!isShareResultPayload(payload)) throw new ShareResultTokenError();
    if (now < payload.createdAt - 5 * 60 * 1000 || now - payload.createdAt > SHARE_RESULT_TTL_MS) {
      throw new ShareResultTokenError();
    }
    return payload;
  } catch (error) {
    if (error instanceof ShareResultTokenError) throw error;
    throw new ShareResultTokenError();
  }
}
