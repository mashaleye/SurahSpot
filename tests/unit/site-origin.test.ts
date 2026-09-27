import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The origin feeds `metadataBase` and the sitemap.
 *
 * Both fail silently when it is wrong — a shared link simply shows no card,
 * and a sitemap lists URLs for the wrong host — so the fallbacks are worth
 * pinning down rather than discovering in a link preview.
 */

const load = async () => {
  vi.resetModules();
  return import("@/lib/config/site");
};

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("siteOrigin", () => {
  it("defaults to the production domain", async () => {
    delete process.env.SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const { siteOrigin } = await load();
    expect(siteOrigin()).toBe("https://surahspot.com");
  });

  it("uses SITE_URL when set", async () => {
    process.env.SITE_URL = "https://staging.surahspot.com";
    const { siteOrigin } = await load();
    expect(siteOrigin()).toBe("https://staging.surahspot.com");
  });

  it("prefers the runtime variable over the build-time one", async () => {
    // A NEXT_PUBLIC_ value is baked in at build time, so a deployment that
    // sets SITE_URL to move hosts must not be overridden by a stale bundle.
    process.env.NEXT_PUBLIC_SITE_URL = "https://old.example.com";
    process.env.SITE_URL = "https://new.example.com";
    const { siteOrigin } = await load();
    expect(siteOrigin()).toBe("https://new.example.com");
  });

  it("still honours NEXT_PUBLIC_SITE_URL on its own", async () => {
    delete process.env.SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://preview.example.com";
    const { siteOrigin } = await load();
    expect(siteOrigin()).toBe("https://preview.example.com");
  });

  it("keeps only the origin, dropping any path or trailing slash", async () => {
    process.env.SITE_URL = "https://surahspot.com/app/";
    const { siteOrigin } = await load();
    expect(siteOrigin()).toBe("https://surahspot.com");
  });

  it("falls back rather than throwing on a malformed value", async () => {
    // metadataBase throws on a bad URL, which would take every page down —
    // too steep a price for a typo in an environment variable.
    process.env.SITE_URL = "not a url";
    const { siteOrigin } = await load();
    expect(siteOrigin()).toBe("https://surahspot.com");
  });

  it("ignores an empty or whitespace value", async () => {
    process.env.SITE_URL = "   ";
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const { siteOrigin } = await load();
    expect(siteOrigin()).toBe("https://surahspot.com");
  });

  it("returns a URL that metadataBase can use directly", async () => {
    process.env.SITE_URL = "https://surahspot.com";
    const { siteUrl } = await load();
    const url = siteUrl();
    expect(url).toBeInstanceOf(URL);
    // This is the resolution Next performs for a generated OG image.
    expect(new URL("/opengraph-image", url).toString())
      .toBe("https://surahspot.com/opengraph-image");
  });
});
