import "server-only";

import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";

import { NextResponse } from "next/server";

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

/**
 * Conditional responses for Qur'an content.
 *
 * The reading endpoints return the same bytes for the same Surah and
 * translation more or less forever — the text does not change — but they are
 * dynamic routes, so Next adds no validator of its own and every revisit
 * re-downloads the whole payload. Al-Baqarah with a translation is about 83KB.
 *
 * Giving those responses an ETag turns a revisit into a 304 of a couple of
 * hundred bytes. On a phone on mobile data, over a month of reading, that is
 * the difference between tens of megabytes and almost none.
 *
 * Not used for anything personal or answer-bearing: those routes are
 * explicitly no-store, and a validator on them would be a way to probe for
 * changes.
 */

/**
 * Five minutes of freshness, then revalidate.
 *
 * `private` keeps it out of shared caches — the payload is shaped by the
 * reader's chosen translation, and the URL carries that, but a CDN keying on
 * the path alone would still be a risk not worth taking for content this
 * cheap to revalidate.
 */
export const CONTENT_CACHE_CONTROL = "private, max-age=300, stale-while-revalidate=86400";

/** A strong validator over exactly the bytes that will be sent. */
export function etagFor(payload: unknown): string {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return `"${createHash("sha1").update(body).digest("base64url")}"`;
}

/**
 * Whether the client already holds this exact response.
 *
 * Handles the comma-separated list form and the weak prefix, both of which
 * appear in the wild, so a proxy that weakens the tag does not silently turn
 * every revalidation back into a full download.
 */
export function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;

  const normalize = (value: string) => value.trim().replace(/^W\//, "");
  const wanted = normalize(etag);

  return header.split(",").some((candidate) => normalize(candidate) === wanted);
}

/**
 * Below this, compression costs more than it saves.
 *
 * A gzip member carries about 20 bytes of framing, and short JSON payloads
 * routinely come out larger compressed than raw.
 */
const MIN_COMPRESS_BYTES = 1_024;

/**
 * Which encoding the client will accept, best first.
 *
 * Deliberately simple: this is a preference list, not a full q-value
 * negotiation. Every browser that supports Brotli advertises it plainly, and
 * anything unusual falls through to an uncompressed response, which is always
 * correct.
 */
function negotiateEncoding(acceptEncoding: string | null): "br" | "gzip" | null {
  if (!acceptEncoding) return null;
  const header = acceptEncoding.toLowerCase();
  if (header.includes("br")) return "br";
  if (header.includes("gzip")) return "gzip";
  return null;
}

async function compress(body: string, encoding: "br" | "gzip"): Promise<Buffer> {
  if (encoding === "gzip") return gzipAsync(body);

  return brotliAsync(body, {
    params: {
      // Quality 4 rather than the default 11. This is compressed per request,
      // not once at build time: 11 would spend tens of milliseconds to save a
      // few percent over 4, which on a route serving a whole Surah is the
      // wrong trade every time.
      [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(body),
    },
  });
}

/**
 * Send `payload`, or a 304 when the client's copy is already current.
 *
 * A 304 must carry the same validator and caching headers as the 200 it
 * stands in for, otherwise the browser has nothing to store against the copy
 * it keeps and will ask again in full next time.
 *
 * The body is compressed here rather than left to the platform. Next does not
 * compress App Router route handler responses, so on a self-hosted deployment
 * with no reverse proxy in front, a Surah goes out at its full size — 83KB
 * for Al-Baqarah, against roughly a fifth of that compressed. Where a CDN or
 * proxy does compress, it sees a response already encoded and passes it
 * through.
 */
export async function jsonWithValidator(
  payload: unknown,
  ifNoneMatch: string | null,
  options: { cacheControl?: string; acceptEncoding?: string | null } = {},
): Promise<NextResponse> {
  const { cacheControl = CONTENT_CACHE_CONTROL, acceptEncoding = null } = options;

  const body = JSON.stringify(payload);
  const etag = etagFor(body);

  const headers: Record<string, string> = {
    ETag: etag,
    "Cache-Control": cacheControl,
    // Without this, a shared cache could hand a Brotli body to a client that
    // cannot read it.
    Vary: "Accept-Encoding",
  };

  if (matchesIfNoneMatch(ifNoneMatch, etag)) {
    return new NextResponse(null, { status: 304, headers });
  }

  const encoding = Buffer.byteLength(body) >= MIN_COMPRESS_BYTES
    ? negotiateEncoding(acceptEncoding)
    : null;

  if (!encoding) {
    return new NextResponse(body, {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  try {
    const compressed = await compress(body, encoding);
    /*
     * Copied into a plain Uint8Array rather than handed over as-is. A Node
     * Buffer is a view onto a shared, possibly pooled ArrayBuffer, and
     * passing the view's `buffer` through would expose whatever else happens
     * to sit in that pool. The copy also gives the body type TypeScript
     * wants, which a Buffer view no longer satisfies.
     */
    const bytes = Uint8Array.from(compressed);

    return new NextResponse(bytes, {
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Content-Encoding": encoding,
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch {
    // Compression is an optimization; a failure must not cost the response.
    return new NextResponse(body, {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
}
