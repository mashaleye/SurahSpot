import { describe, expect, it } from "vitest";
import { formatShareResultText, sharePresentation } from "@/lib/share/result-copy";
import { openShareResult, sealShareResult, ShareResultTokenError } from "@/lib/share/result-token";
import type { ShareResultPayload } from "@/lib/share/result-types";

function result(overrides: Partial<ShareResultPayload> = {}): ShareResultPayload {
  return {
    version: 1,
    mode: "identify-surah",
    score: 580,
    roundsPlayed: 7,
    roundsWon: 6,
    bestStreak: 4,
    exact: 0,
    firstTryWins: 3,
    roundStates: ["perfect", "perfect", "close", "perfect", "missed", "perfect", "perfect"],
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("share result tokens", () => {
  it("round-trips only the spoiler-free public result contract", () => {
    const payload = result();
    const opened = openShareResult(sealShareResult(payload));
    expect(opened).toEqual(payload);
    expect(JSON.stringify(opened)).not.toMatch(/chapter|surahName|verse|answer|completion|sequenceOrder/i);
  });

  it("rejects a tampered public result", () => {
    const token = sealShareResult(result());
    const [body, sig] = token.split(".");
    const tampered = `${body.slice(0, -1)}${body.endsWith("A") ? "B" : "A"}.${sig}`;
    expect(() => openShareResult(tampered)).toThrow(ShareResultTokenError);
  });

  it("formats mode-aware copy without answers", () => {
    const text = formatShareResultText(result({ mode: "completion", variant: "sequence", roundsWon: 5, score: 560 }), "https://surahspot.com/r/test");
    expect(text).toMatch(/Completion/i);
    expect(text).toMatch(/5\/7 completed/i);
    expect(text).toMatch(/Do you know what comes next/i);
    expect(text).not.toMatch(/Al-Kahf|Ayah 12|correctSequence/i);
  });

  it("uses mode-specific social-card headlines", () => {
    expect(sharePresentation(result()).headline).toMatch(/recognize/i);
    expect(sharePresentation(result({ mode: "ayah-counts", variant: "exact" })).headline).toMatch(/count/i);
    expect(sharePresentation(result({ mode: "completion", variant: "fill-in" })).headline).toMatch(/complete/i);
    expect(sharePresentation(result({ mode: "completion", variant: "sequence" })).headline).toMatch(/comes next/i);
  });
});
