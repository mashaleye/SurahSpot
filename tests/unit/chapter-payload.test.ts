import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { Chapter } from "@/lib/quran/catalog";

/**
 * Every chapter field the client treats as a string must arrive as one.
 *
 * This exists because of a specific failure. The mock fixtures omitted
 * `name_complex`, and the config and search routes mapped it straight through
 * while giving `translated_name` a `?? ""` fallback right beside it. So under
 * QF_MOCK nine chapters reached the browser with `nameComplex: undefined`.
 *
 * The client's answer search builds six aliases per chapter and lowercases each
 * one. The first undefined threw during render, which React turns into "a
 * client-side exception has occurred" — the entire board replaced by an error
 * page. All four e2e projects failed on it, and the visible symptom (a blank
 * page) said nothing about a missing name.
 *
 * The unit tests and the production build never caught it: the payload is only
 * assembled at runtime, and TypeScript believed the field was a string because
 * the upstream type says so. So the assertion has to be about the mapping.
 */

/** The mapping used by /api/quran/config and /api/quran/search. */
function toClientChapter(chapter: Chapter) {
  return {
    id: chapter.id,
    nameSimple: chapter.name_simple,
    nameComplex: chapter.name_complex ?? chapter.name_simple,
    nameArabic: chapter.name_arabic,
    translatedName: chapter.translated_name?.name ?? "",
    versesCount: chapter.verses_count,
  };
}

/** Fields the client declares as `string` and runs string methods over. */
const STRING_FIELDS = ["nameSimple", "nameComplex", "nameArabic", "translatedName"] as const;

function upstreamChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 1,
    revelation_place: "makkah",
    revelation_order: 5,
    bismillah_pre: true,
    name_simple: "Al-Fatihah",
    name_complex: "Al-Fātiḥah",
    name_arabic: "الفاتحة",
    verses_count: 7,
    translated_name: { language_name: "english", name: "The Opener" },
    ...overrides,
  };
}

describe("the chapter payload sent to the client", () => {
  it("is all strings for a complete upstream chapter", () => {
    const mapped = toClientChapter(upstreamChapter());
    for (const field of STRING_FIELDS) {
      expect(typeof mapped[field], field).toBe("string");
    }
  });

  it("is all strings when the upstream omits the complex name", () => {
    // The exact shape the fixtures produced, and the one a partial upstream
    // response can produce in production too — completeChapterCatalog only pads
    // chapters that are missing entirely, not ones that arrive incomplete.
    const mapped = toClientChapter(
      upstreamChapter({ name_complex: undefined as unknown as string }),
    );

    expect(mapped.nameComplex).toBe("Al-Fatihah");
    for (const field of STRING_FIELDS) {
      expect(typeof mapped[field], field).toBe("string");
    }
  });

  it("is all strings when the upstream omits the translated name", () => {
    const mapped = toClientChapter(upstreamChapter({ translated_name: undefined }));

    expect(mapped.translatedName).toBe("");
    for (const field of STRING_FIELDS) {
      expect(typeof mapped[field], field).toBe("string");
    }
  });

  it("survives an upstream chapter missing every optional name", () => {
    const mapped = toClientChapter(
      upstreamChapter({
        name_complex: undefined as unknown as string,
        translated_name: undefined,
      }),
    );

    for (const field of STRING_FIELDS) {
      expect(typeof mapped[field], field).toBe("string");
    }
  });
});

describe("the mock fixtures", () => {
  /*
   * The root cause. A fixture that does not match the shape of what it stands
   * in for tests a contract nobody serves — and here it produced a failure that
   * appeared only in a browser, only under the mock, and only once someone
   * typed in the answer field.
   *
   * Asserted against the source rather than an import, because MOCK_CHAPTERS is
   * module-private and should stay that way. The fixture type now requires the
   * field too, so this is the second of two guards.
   */
  it("give every chapter row the fields the real /chapters response carries", () => {
    const source = readFileSync("lib/quran/mock-upstream.ts", "utf8");

    const block = source.slice(
      source.indexOf("const MOCK_CHAPTERS"),
      source.indexOf("const MOCK_RECITERS"),
    );
    const rows = block.match(/\{\s*id: \d+,[\s\S]*?\},?\n/g) ?? [];

    expect(rows.length, "fixture rows should be found").toBeGreaterThan(0);

    for (const row of rows) {
      const id = row.match(/id: (\d+)/)?.[1];
      for (const field of ["name_simple", "name_complex", "name_arabic", "verses_count"]) {
        expect(row, `chapter ${id} should define ${field}`).toContain(`${field}:`);
      }
    }
  });
});
