import { describe, expect, it } from "vitest";
import { buildArabicSatoriLines } from "@/lib/share/rtl-card-text";

function restoreLogicalOrder(line: string) {
  return line.split(" ").reverse().join(" ");
}

describe("Arabic share-card Satori workaround", () => {
  it("keeps the Ayah's logical reading order across generated lines", () => {
    const source = "عَيْنًا يَشْرَبُ بِهَا الْمُقَرَّبُونَ";
    const lines = buildArabicSatoriLines(source, {
      maxChars: 190,
      maxVisualUnitsPerLine: 12,
      maxLines: 3,
    });

    expect(lines.map(restoreLogicalOrder).join(" ")).toBe(source);
  });

  it("reverses only the word sequence Satori positions incorrectly", () => {
    expect(
      buildArabicSatoriLines("الأول الثاني الثالث", {
        maxVisualUnitsPerLine: 99,
      }),
    ).toEqual(["الثالث الثاني الأول"]);
  });

  it("does not mutate or normalize Quranic marks inside words", () => {
    const source = "قُلْ هُوَ اللَّهُ أَحَدٌ";
    const [line] = buildArabicSatoriLines(source, {
      maxVisualUnitsPerLine: 99,
    });

    expect(restoreLogicalOrder(line)).toBe(source);
  });
});
