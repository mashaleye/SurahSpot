import { describe, expect, it } from "vitest";

import {
  CONTENT_CACHE_CONTROL,
  etagFor,
  jsonWithValidator,
  matchesIfNoneMatch,
} from "@/lib/http/conditional";

/**
 * These rules decide whether a returning reader downloads a Surah again or
 * gets a 304. Getting the comparison wrong in either direction is costly: too
 * strict and every revisit is a full payload, too loose and a reader is
 * served a stale translation they cannot refresh.
 */

describe("etagFor", () => {
  it("is stable for the same payload", () => {
    const payload = { chapter: 2, verses: [{ n: 1, text: "الم" }] };
    expect(etagFor(payload)).toBe(etagFor({ chapter: 2, verses: [{ n: 1, text: "الم" }] }));
  });

  it("changes when any byte of the payload changes", () => {
    expect(etagFor({ a: 1 })).not.toBe(etagFor({ a: 2 }));
    // A different translation must not reuse the previous one's validator.
    expect(etagFor({ text: "Praise be" })).not.toBe(etagFor({ text: "All praise" }));
  });

  it("is a quoted strong validator, as the header syntax requires", () => {
    const etag = etagFor({ a: 1 });
    expect(etag.startsWith('"')).toBe(true);
    expect(etag.endsWith('"')).toBe(true);
    expect(etag.startsWith("W/")).toBe(false);
  });
});

describe("matchesIfNoneMatch", () => {
  const etag = etagFor({ a: 1 });

  it("matches an exact tag", () => {
    expect(matchesIfNoneMatch(etag, etag)).toBe(true);
  });

  it("does not match a different tag", () => {
    expect(matchesIfNoneMatch(etagFor({ a: 2 }), etag)).toBe(false);
  });

  it("matches when a proxy has weakened the tag", () => {
    // Some intermediaries rewrite strong tags as weak. Refusing those would
    // turn every revalidation back into a full download.
    expect(matchesIfNoneMatch(`W/${etag}`, etag)).toBe(true);
  });

  it("matches one tag out of a list", () => {
    expect(matchesIfNoneMatch(`"other", ${etag}, "another"`, etag)).toBe(true);
  });

  it("matches the wildcard", () => {
    expect(matchesIfNoneMatch("*", etag)).toBe(true);
  });

  it("treats an absent or empty header as no match", () => {
    expect(matchesIfNoneMatch(null, etag)).toBe(false);
    expect(matchesIfNoneMatch("", etag)).toBe(false);
  });
});

describe("jsonWithValidator", () => {
  const payload = { chapter: 112, verses: 4 };

  it("sends the body with a validator when the client has nothing", async () => {
    const response = await jsonWithValidator(payload, null);
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe(etagFor(payload));
    expect(response.headers.get("Cache-Control")).toBe(CONTENT_CACHE_CONTROL);
    expect(await response.json()).toEqual(payload);
  });

  it("sends 304 with no body when the client is already current", async () => {
    const response = await jsonWithValidator(payload, etagFor(payload));
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  it("repeats the validator and caching headers on the 304", async () => {
    // Without these the browser has nothing to store against the copy it
    // keeps, so the next request is unconditional and the saving is lost.
    const response = await jsonWithValidator(payload, etagFor(payload));
    expect(response.headers.get("ETag")).toBe(etagFor(payload));
    expect(response.headers.get("Cache-Control")).toBe(CONTENT_CACHE_CONTROL);
  });

  it("sends the body when the client holds a different version", async () => {
    const response = await jsonWithValidator(payload, etagFor({ chapter: 112, verses: 5 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
  });

  it("keeps the content out of shared caches", () => {
    // The payload is shaped by the reader's chosen translation.
    expect(CONTENT_CACHE_CONTROL).toContain("private");
  });
});

/**
 * A Surah goes out at about 83KB uncompressed, and Next does not compress
 * route handler responses — so without this the whole payload crosses a
 * phone's mobile connection raw.
 */
describe("compression", () => {
  /** Big enough to be worth compressing, and repetitive like real Ayah text. */
  const large = { verses: Array.from({ length: 400 }, (_, i) => ({ n: i, text: "وَٱلضُّحَىٰ", translation: "By the morning brightness" })) };
  const raw = Buffer.byteLength(JSON.stringify(large));

  it("compresses a large payload with Brotli when offered", async () => {
    const response = await jsonWithValidator(large, null, { acceptEncoding: "gzip, deflate, br" });
    expect(response.headers.get("Content-Encoding")).toBe("br");
    const sent = (await response.arrayBuffer()).byteLength;
    expect(sent).toBeLessThan(raw / 2);
  });

  it("falls back to gzip for a client that does not take Brotli", async () => {
    const response = await jsonWithValidator(large, null, { acceptEncoding: "gzip, deflate" });
    expect(response.headers.get("Content-Encoding")).toBe("gzip");
    expect((await response.arrayBuffer()).byteLength).toBeLessThan(raw / 2);
  });

  it("sends plain JSON to a client that accepts no encoding", async () => {
    const response = await jsonWithValidator(large, null, { acceptEncoding: null });
    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(await response.json()).toEqual(large);
  });

  it("leaves small payloads alone, where framing costs more than it saves", async () => {
    const response = await jsonWithValidator({ ok: true }, null, { acceptEncoding: "br" });
    expect(response.headers.get("Content-Encoding")).toBeNull();
  });

  it("varies on Accept-Encoding, so a shared cache cannot cross the wires", async () => {
    const response = await jsonWithValidator(large, null, { acceptEncoding: "br" });
    expect(response.headers.get("Vary")).toContain("Accept-Encoding");
  });

  it("keeps the same validator whatever the encoding", async () => {
    // The ETag identifies the resource, not the transfer encoding, so a
    // client that revalidates after switching encodings still gets its 304.
    const br = await jsonWithValidator(large, null, { acceptEncoding: "br" });
    const plain = await jsonWithValidator(large, null, { acceptEncoding: null });
    expect(br.headers.get("ETag")).toBe(plain.headers.get("ETag"));
  });

  it("answers a conditional request without compressing anything", async () => {
    const response = await jsonWithValidator(large, etagFor(large), { acceptEncoding: "br" });
    expect(response.status).toBe(304);
    expect(response.headers.get("Content-Encoding")).toBeNull();
  });

  it("declares the compressed length, not the original", async () => {
    const response = await jsonWithValidator(large, null, { acceptEncoding: "br" });
    const declared = Number(response.headers.get("Content-Length"));
    expect(declared).toBe((await response.arrayBuffer()).byteLength);
    expect(declared).toBeLessThan(raw);
  });
});
