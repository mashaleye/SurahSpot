import { describe, expect, it } from "vitest";
import { juzForVerseKey, parseVerseKey, verseNumberFromKey } from "@/lib/quran/juz";
import {
  buildQuranDisplayVerseText,
  buildQuranDisplayWords,
  cleanQuranArabicForDisplay,
  cleanTranslationHtml,
  normalizeSurahQuery,
} from "@/lib/quran/text";

/** TC-047, TC-086, TC-091. */

describe("juz lookup", () => {
  it.each([
    ["1:1", 1],
    ["2:141", 1],   // last ayah before Juz 2 begins
    ["2:142", 2],   // exact Juz 2 boundary
    ["2:253", 3],
    ["18:74", 15],
    ["18:75", 16],
    ["36:1", 22],
    ["78:1", 30],
    ["114:6", 30],
  ])("places %s in Juz %i", (verseKey, expected) => {
    expect(juzForVerseKey(verseKey)).toBe(expected);
  });

  it("reports the Juz of the specific Ayah, not of the whole Surah", () => {
    // TC-047. Al-Baqarah spans Juz 1 to 3; the hint must narrow, not restate.
    expect(juzForVerseKey("2:1")).toBe(1);
    expect(juzForVerseKey("2:200")).toBe(2);
    expect(juzForVerseKey("2:280")).toBe(3);
  });

  it("rejects malformed keys instead of guessing", () => {
    expect(juzForVerseKey("nonsense")).toBeNull();
    expect(juzForVerseKey("2")).toBeNull();
    expect(juzForVerseKey("0:1")).toBeNull();
    expect(juzForVerseKey("115:1")).toBeNull();
    expect(juzForVerseKey("2:0")).toBeNull();
    expect(juzForVerseKey("1:2:3")).toBeNull();
  });

  it("parses a verse key into its parts", () => {
    expect(parseVerseKey("36:12")).toEqual({ chapter: 36, verse: 12 });
    expect(parseVerseKey("36:x")).toBeNull();
  });

  it("extracts the verse number and checks the chapter when asked", () => {
    expect(verseNumberFromKey("36:12")).toBe(12);
    expect(verseNumberFromKey("36:12", 36)).toBe(12);
    expect(verseNumberFromKey("36:12", 2)).toBeNull();
  });
});

describe("translation sanitization", () => {
  it("removes footnote superscripts entirely", () => {
    // TC-091
    const input = 'In the name of Allah<sup foot_note="1234">1</sup>, the Most Merciful.';
    expect(cleanTranslationHtml(input)).toBe("In the name of Allah, the Most Merciful.");
  });

  it("separates rather than fuses adjacent spans", () => {
    // TC-086: replacing markup with nothing produced "theCow".
    expect(cleanTranslationHtml("<span>the</span><span>Cow</span>")).toBe("the Cow");
  });

  it("turns line breaks into spaces", () => {
    expect(cleanTranslationHtml("First line.<br>Second line.")).toBe("First line. Second line.");
    expect(cleanTranslationHtml("First.<br />Second.")).toBe("First. Second.");
  });

  it("decodes the entities QF actually emits", () => {
    expect(cleanTranslationHtml("Moses&nbsp;&amp;&nbsp;Aaron")).toBe("Moses & Aaron");
    expect(cleanTranslationHtml("&quot;Read&quot; &#39;now&#39;")).toBe('"Read" \'now\'');
    expect(cleanTranslationHtml("&apos;peace&apos;")).toBe("'peace'");
  });

  it("collapses whitespace left behind by stripped markup", () => {
    expect(cleanTranslationHtml("  the   <b> word </b>   here  ")).toBe("the word here");
  });

  it("handles empty and absent input", () => {
    expect(cleanTranslationHtml("")).toBe("");
    expect(cleanTranslationHtml("   ")).toBe("");
  });
});

describe("surah query normalization", () => {
  it.each([
    ["Baqarah", "baqarah"],          // TC-032
    ["surah baqarah", "baqarah"],    // TC-033
    ["Al-Baqarah", "albaqarah"],
    ["Al Baqarah", "al baqarah"],
    ["Ali 'Imran", "ali imran"],
    ["Ad-Duhaa", "adduhaa"],
    ["  YA-SIN  ", "yasin"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeSurahQuery(input)).toBe(expected);
  });

  it("strips combining diacritics so accented input still matches", () => {
    expect(normalizeSurahQuery("Mooré")).toBe("moore");
  });

  it("returns an empty string for whitespace", () => {
    expect(normalizeSurahQuery("   ")).toBe("");
  });
});

describe("Quran Arabic display sanitization", () => {
  it("removes the small high rounded zero display mark", () => {
    expect(
      cleanQuranArabicForDisplay("قَالُوا۟"),
    ).toBe("قَالُوا");

    expect(
      cleanQuranArabicForDisplay("كَانُوا۟"),
    ).toBe("كَانُوا");

    expect(
      cleanQuranArabicForDisplay("ءَامَنُوا۟"),
    ).toBe("ءَامَنُوا");
  });

  it("removes U+06DF wherever it occurs in an Ayah", () => {
    const input =
      "قَالُوا۟ نَشْهَدُ إِنَّكَ لَرَسُولُ اللَّهِ";

    expect(
      cleanQuranArabicForDisplay(input),
    ).toBe(
      "قَالُوا نَشْهَدُ إِنَّكَ لَرَسُولُ اللَّهِ",
    );
  });

  it("does not strip normal Quranic Arabic diacritics", () => {
    const input =
      "إِنَّ ٱللَّهَ عَلِيمٌ حَكِيمٌ";

    expect(
      cleanQuranArabicForDisplay(input),
    ).toBe(input);
  });

  it("does not remove Arabic-Indic numbers", () => {
    expect(
      cleanQuranArabicForDisplay("١٠"),
    ).toBe("١٠");

    expect(
      cleanQuranArabicForDisplay("٢٨٦"),
    ).toBe("٢٨٦");
  });

  it("does not remove an Ayah number merely because it contains zero", () => {
    expect(
      cleanQuranArabicForDisplay("١٠"),
    ).not.toBe("١");
  });

  it("builds sanitized karaoke words while preserving QF positions", () => {
    const words = buildQuranDisplayWords([
      {
        position: 1,
        text_uthmani: "قَالُوا۟",
        char_type_name: "word",
      },
      {
        position: 2,
        text_uthmani: "نَشْهَدُ",
        char_type_name: "word",
      },
    ]);

    expect(words).toEqual([
      {
        index: 0,
        position: 1,
        arabic: "قَالُوا",
      },
      {
        index: 1,
        position: 2,
        arabic: "نَشْهَدُ",
      },
    ]);
  });

  it("removes the QF end-of-Ayah metadata token", () => {
    const words = buildQuranDisplayWords([
      {
        position: 1,
        text_uthmani: "ٱللَّهُ",
        char_type_name: "word",
      },
      {
        position: 2,
        text_uthmani: "\u06DD",
        char_type_name: "end",
      },
    ]);

    expect(words).toEqual([
      {
        index: 0,
        position: 1,
        arabic: "ٱللَّهُ",
      },
    ]);
  });

  it("drops a token that becomes display-empty after sanitization", () => {
    const words = buildQuranDisplayWords([
      {
        position: 4,
        text_uthmani: "\u06DF",
        char_type_name: "word",
      },
      {
        position: 5,
        text_uthmani: "اللَّهِ",
        char_type_name: "word",
      },
    ]);

    expect(words).toEqual([
      {
        index: 0,
        position: 5,
        arabic: "اللَّهِ",
      },
    ]);
  });

  it("sanitizes complete verse text as well as word text", () => {
    const words = buildQuranDisplayWords([
      {
        position: 1,
        text_uthmani: "قَالُوا۟",
        char_type_name: "word",
      },
    ]);

    expect(
      buildQuranDisplayVerseText(
        "قَالُوا۟ نَشْهَدُ",
        words,
      ),
    ).toBe("قَالُوا نَشْهَدُ");
  });

  it("falls back to sanitized words when full verse text is unavailable", () => {
    const words = buildQuranDisplayWords([
      {
        position: 1,
        text_uthmani: "قَالُوا۟",
        char_type_name: "word",
      },
      {
        position: 2,
        text_uthmani: "نَشْهَدُ",
        char_type_name: "word",
      },
    ]);

    expect(
      buildQuranDisplayVerseText(undefined, words),
    ).toBe("قَالُوا نَشْهَدُ");
  });
});