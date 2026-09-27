import { describe, expect, it } from "vitest";
import {
  LEARNING_MUSHAF_ID,
  LEARNING_TOTAL_PAGES,
  formatNumberSpan,
  parseAyahRange,
} from "@/lib/learning/types";

describe("Learning Blocks helpers", () => {
  it("uses the standard 604-page Madani/QCF V2 layout", () => {
    expect(LEARNING_MUSHAF_ID).toBe(1);
    expect(LEARNING_TOTAL_PAGES).toBe(604);
  });

  it("parses accessible Ayah ranges", () => {
    expect(parseAyahRange("7-12", 20)).toEqual({ start: 7, end: 12 });
    expect(parseAyahRange("1 – 10", 10)).toEqual({ start: 1, end: 10 });
    expect(parseAyahRange("7—17", 30)).toEqual({ start: 7, end: 17 });
    expect(parseAyahRange("5,10", 20)).toEqual({ start: 5, end: 10 });
    expect(parseAyahRange("7, 12", 20)).toEqual({ start: 7, end: 12 });
    expect(parseAyahRange("1،6", 20)).toEqual({ start: 1, end: 6 });
  });

  it("rejects reversed, zero, and out-of-Surah ranges", () => {
    expect(parseAyahRange("12-7", 20)).toBeNull();
    expect(parseAyahRange("0-5", 20)).toBeNull();
    expect(parseAyahRange("7-21", 20)).toBeNull();
    expect(parseAyahRange("not a range", 20)).toBeNull();
  });

  it("formats page metadata spans", () => {
    expect(formatNumberSpan([1])).toBe("1");
    expect(formatNumberSpan([2, 1, 2])).toBe("1–2");
    expect(formatNumberSpan([])).toBe("—");
  });
});
