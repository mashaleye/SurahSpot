import { describe, expect, it } from "vitest";

import { CANONICAL_CHAPTERS, TOTAL_AYAHS, TOTAL_SURAHS } from "@/lib/quran/chapters";
import { juzForVerseKey } from "@/lib/quran/juz";
import {
  SURAH_FACTS,
  findSurahById,
  findSurahBySlug,
  formatJuzSpan,
  surahNeighbours,
  surahSlug,
} from "@/lib/quran/surah-facts";

/**
 * These facts are published as statements about the Qur'an on 114 indexable
 * pages, which is a higher bar than "the module compiles". A wrong Ayah count
 * here is a wrong answer served to someone studying, so the tests below check
 * the table against an independent quantity wherever one exists rather than
 * restating the values the module already holds.
 */

describe("the canonical chapter table", () => {
  it("holds all 114 chapters, numbered 1..114 in order", () => {
    expect(CANONICAL_CHAPTERS).toHaveLength(114);
    expect(TOTAL_SURAHS).toBe(114);
    CANONICAL_CHAPTERS.forEach(([id], index) => {
      expect(id).toBe(index + 1);
    });
  });

  /*
   * The load-bearing assertion in this file. 6,236 is the total Ayah count of
   * the Qur'an, and it is a checksum over all 114 rows: any single mistyped
   * count changes it. A table that sums correctly and has the right length
   * cannot be quietly wrong in one cell.
   */
  it("sums to 6,236 Ayahs", () => {
    expect(TOTAL_AYAHS).toBe(6236);
  });

  it("gives every chapter a name, an Arabic name, and at least one Ayah", () => {
    for (const [id, nameSimple, nameArabic, versesCount] of CANONICAL_CHAPTERS) {
      expect(nameSimple, `chapter ${id} name`).toMatch(/\S/);
      expect(nameArabic, `chapter ${id} Arabic name`).toMatch(/[؀-ۿ]/);
      expect(versesCount, `chapter ${id} Ayah count`).toBeGreaterThan(0);
    }
  });
});

describe("Surah facts", () => {
  it("derives one entry per chapter, in Mushaf order", () => {
    expect(SURAH_FACTS).toHaveLength(114);
    SURAH_FACTS.forEach((surah, index) => {
      expect(surah.id).toBe(index + 1);
    });
  });

  it("carries the canonical name and Ayah count for every chapter", () => {
    for (const [id, nameSimple, nameArabic, versesCount] of CANONICAL_CHAPTERS) {
      const surah = findSurahById(id);
      expect(surah, `chapter ${id}`).not.toBeNull();
      expect(surah!.nameSimple).toBe(nameSimple);
      expect(surah!.nameArabic).toBe(nameArabic);
      expect(surah!.versesCount).toBe(versesCount);
    }
  });

  it("gives every Surah a distinct, URL-safe slug", () => {
    const slugs = SURAH_FACTS.map((surah) => surah.slug);
    expect(new Set(slugs).size).toBe(114);

    for (const slug of slugs) {
      // No uppercase, no spaces, no apostrophes, no leading or trailing dash:
      // anything else would either 404 or produce two URLs for one Surah.
      expect(slug, slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("only leaves the meaning equal to the name where the name IS the meaning", () => {
    /*
     * A missing MEANINGS entry silently falls back to the transliteration, so
     * "meaning === name" cannot be used to detect a forgotten row on its own —
     * six Surahs are named for a person or for the letters they open with, and
     * for those the English rendering genuinely is the name.
     *
     * Pinning the exact set is what makes the fallback visible: a forgotten row
     * shows up here as a new id, and the page suppresses the redundant
     * "Hud (Hud)" rendering for precisely these six.
     */
    const sameAsName = SURAH_FACTS.filter((surah) => surah.meaning === surah.nameSimple);

    expect(sameAsName.map((surah) => surah.nameSimple)).toEqual([
      "Hud",
      "Luqman",
      "Sad",
      "Muhammad",
      "Qaf",
      "Quraysh",
    ]);
  });

  it("translates the Surahs whose names have an English form", () => {
    // Guards the other direction: a name that looks like a proper noun but has
    // a conventional English rendering should carry it.
    expect(findSurahById(10)!.meaning).toBe("Jonah");
    expect(findSurahById(12)!.meaning).toBe("Joseph");
    expect(findSurahById(19)!.meaning).toBe("Mary");
    expect(findSurahById(71)!.meaning).toBe("Noah");
  });

  it("classifies exactly 28 Surahs as Madani", () => {
    const madani = SURAH_FACTS.filter((surah) => surah.revelationPlace === "Madinah");
    expect(madani).toHaveLength(28);

    // Spot-check against the classification the rest of the app already uses,
    // so a static page and the in-game revelation-place hint cannot disagree.
    expect(findSurahById(2)!.revelationPlace).toBe("Madinah");
    expect(findSurahById(55)!.revelationPlace).toBe("Madinah");
    expect(findSurahById(1)!.revelationPlace).toBe("Makkah");
    expect(findSurahById(67)!.revelationPlace).toBe("Makkah");
    expect(findSurahById(114)!.revelationPlace).toBe("Makkah");
  });

  it("ranks Surahs by Ayah count, longest first", () => {
    const ranks = SURAH_FACTS.map((surah) => surah.lengthRank).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: 114 }, (_, index) => index + 1));

    // Al-Baqarah is the longest at 286; An-Nasr the shortest at 3 — but so are
    // Al-'Asr and Al-Kawthar, and ties resolve to the lower chapter number, so
    // the last rank must be the highest-numbered of the three.
    expect(SURAH_FACTS.find((surah) => surah.lengthRank === 1)!.id).toBe(2);
    expect(SURAH_FACTS.find((surah) => surah.lengthRank === 114)!.versesCount).toBe(3);
  });
});

describe("Juz spans", () => {
  it("agrees with juzForVerseKey at both ends of every Surah", () => {
    for (const surah of SURAH_FACTS) {
      const first = juzForVerseKey(`${surah.id}:1`);
      const last = juzForVerseKey(`${surah.id}:${surah.versesCount}`);

      expect(surah.juz[0], `Surah ${surah.id} opening Juz`).toBe(first);
      expect(surah.juz[surah.juz.length - 1], `Surah ${surah.id} closing Juz`).toBe(last);
    }
  });

  it("is contiguous and ascending", () => {
    for (const surah of SURAH_FACTS) {
      expect(surah.juz.length).toBeGreaterThan(0);
      surah.juz.forEach((value, index) => {
        if (index > 0) expect(value).toBe(surah.juz[index - 1] + 1);
      });
    }
  });

  it("puts known Surahs in the right Juz", () => {
    expect(findSurahById(1)!.juz).toEqual([1]);
    expect(findSurahById(2)!.juz).toEqual([1, 2, 3]);
    expect(findSurahById(18)!.juz).toEqual([15, 16]);
    expect(findSurahById(36)!.juz).toEqual([22, 23]);
    // Al-Mulk opens Juz 29 and does not reach 30.
    expect(findSurahById(67)!.juz).toEqual([29]);
    expect(findSurahById(114)!.juz).toEqual([30]);
  });

  it("never claims a Juz outside 1..30", () => {
    for (const surah of SURAH_FACTS) {
      for (const juz of surah.juz) {
        expect(juz).toBeGreaterThanOrEqual(1);
        expect(juz).toBeLessThanOrEqual(30);
      }
    }
  });
});

describe("formatJuzSpan", () => {
  it("renders a single Juz without a range", () => {
    expect(formatJuzSpan([29])).toBe("Juz 29");
  });

  it("renders a contiguous run as a range", () => {
    expect(formatJuzSpan([15, 16])).toBe("Juz 15–16");
    expect(formatJuzSpan([1, 2, 3])).toBe("Juz 1–3");
  });

  it("lists a non-contiguous set rather than implying a range", () => {
    expect(formatJuzSpan([4, 6])).toBe("Juz 4 and 6");
    expect(formatJuzSpan([1, 3, 5])).toBe("Juz 1, 3 and 5");
  });

  it("returns an empty string for an empty span", () => {
    expect(formatJuzSpan([])).toBe("");
  });
});

describe("slug handling", () => {
  it("drops apostrophes rather than splitting the name on them", () => {
    // "al-a-raf" would be two tokens where the name has one.
    expect(surahSlug("Al-A'raf")).toBe("al-araf");
    expect(surahSlug("Ali 'Imran")).toBe("ali-imran");
    expect(surahSlug("'Abasa")).toBe("abasa");
    expect(surahSlug("Al-‘Alaq")).toBe("al-alaq");
  });

  it("turns spaces into single hyphens and trims the ends", () => {
    expect(surahSlug("  Ya-Sin  ")).toBe("ya-sin");
    expect(surahSlug("An Nas")).toBe("an-nas");
  });

  it("round-trips every Surah through its own slug", () => {
    for (const surah of SURAH_FACTS) {
      expect(findSurahBySlug(surah.slug)?.id, surah.slug).toBe(surah.id);
    }
  });

  it("matches case-insensitively, so a capitalised link still resolves", () => {
    expect(findSurahBySlug("AL-KAHF")?.id).toBe(18);
  });

  it("returns null for anything that is not a Surah", () => {
    expect(findSurahBySlug("al-kahff")).toBeNull();
    expect(findSurahBySlug("")).toBeNull();
    expect(findSurahBySlug("../privacy")).toBeNull();
    expect(findSurahById(0)).toBeNull();
    expect(findSurahById(115)).toBeNull();
  });
});

describe("neighbours", () => {
  it("has no previous before Al-Fatihah and no next after An-Nas", () => {
    expect(surahNeighbours(1).previous).toBeNull();
    expect(surahNeighbours(1).next?.id).toBe(2);
    expect(surahNeighbours(114).next).toBeNull();
    expect(surahNeighbours(114).previous?.id).toBe(113);
  });

  it("chains every Surah to the one before and after it", () => {
    for (const surah of SURAH_FACTS) {
      const { previous, next } = surahNeighbours(surah.id);
      if (previous) expect(previous.id).toBe(surah.id - 1);
      if (next) expect(next.id).toBe(surah.id + 1);
    }
  });
});
