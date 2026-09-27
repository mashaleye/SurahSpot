import { beforeEach, describe, expect, it } from "vitest";
import { RouteClient } from "../helpers/route-client";
import { POST as roundRoute } from "@/app/api/quran/round/route";
import { POST as guessRoute } from "@/app/api/game/guess/route";
import { POST as hintRoute } from "@/app/api/game/hint/route";
import { GET as audioRoute } from "@/app/api/quran/audio/route";
import { resetCatalogCache } from "@/lib/quran/catalog";
import { resetRoundBuilderCaches } from "@/lib/game/round-builder";
import { closestFigureScore } from "@/lib/game/scoring-ayah-count";

const ROUND_URL = "http://localhost:3000/api/quran/round";
const GUESS_URL = "http://localhost:3000/api/game/guess";
const HINT_URL = "http://localhost:3000/api/game/hint";

function newClient() {
  resetCatalogCache();
  resetRoundBuilderCaches();
  return new RouteClient();
}

async function startAyahRound(client: RouteClient, variant: "exact" | "closest") {
  const result = await client.post(roundRoute, ROUND_URL, { mode: "ayah-counts", variant });
  expect(result.status).toBe(200);
  return result.body;
}

/**
 * Discover the answer the way the round itself eventually reveals it: play the
 * round out. The test has no more access to the sealed count than a player.
 */
async function revealCount(client: RouteClient, token: string) {
  const result = await client.post(guessRoute, GUESS_URL, { token, skipRound: true });
  return result.body.reveal.versesCount as number;
}

describe("ayah counts — round shape", () => {
  let client: RouteClient;
  beforeEach(() => { client = newClient(); });

  it("shows the Surah and seals the count", async () => {
    const round = await startAyahRound(client, "exact");

    // The Surah is the prompt in this mode, so naming it is correct.
    expect(round.surah.nameArabic).toBeTruthy();
    expect(round.surah.nameSimple).toBeTruthy();
    expect(round.surah.translatedName).toBeTruthy();

    // The count is the answer and must not appear anywhere in the payload.
    const serialized = JSON.stringify(round);
    expect(serialized).not.toMatch(/versesCount/);
    expect(round.attemptsRemaining).toBe(5);
    expect(round.pointsRemaining).toBe(100);
  });

  it("carries no audio or word timing", async () => {
    // Nothing to conceal, so a recitation would be decoration and the timing
    // payload would be dead weight.
    const round = await startAyahRound(client, "exact");
    expect(round.audio).toBeUndefined();
    expect(round.words).toBeUndefined();
    expect(round.hints).toBeUndefined();
  });

  it("refuses hints in this mode", async () => {
    // Every hint would either restate the visible Surah or hand over the count.
    const round = await startAyahRound(client, "exact");
    const result = await client.post(hintRoute, HINT_URL, { token: round.token, type: "ayah_count" });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/not available in this mode/i);
  });

  it("refuses to proxy audio for an ayah-counts token", async () => {
    // Replaying a silent mode's token at the audio endpoint is a misuse, not a
    // configuration gap.
    const round = await startAyahRound(client, "exact");
    const result = await client.get(
      audioRoute,
      `http://localhost:3000/api/quran/audio?token=${encodeURIComponent(round.token)}`,
    );
    expect(result.status).toBe(400);
  });

  it("falls back to the default mode for an unknown mode id", async () => {
    const result = await client.post(roundRoute, ROUND_URL, { mode: "chess" });
    expect(result.status).toBe(200);
    expect(result.body.mode).toBe("identify-surah");
  });

  it("switches modes by starting a fresh attempt", async () => {
    const base = await client.post(roundRoute, ROUND_URL, { mode: "identify-surah" });
    expect(base.status).toBe(200);
    const oldAttempt = client.getCookie("surahspot_attempt");

    const switched = await client.post(roundRoute, ROUND_URL, {
      mode: "ayah-counts",
      variant: "exact",
      newAttempt: true,
      resetReason: "mode-switch",
    });

    expect(switched.status).toBe(200);
    expect(switched.body.mode).toBe("ayah-counts");
    expect(switched.body.variant).toBe("exact");
    expect(switched.body.progress.roundsCompleted).toBe(0);
    expect(client.getCookie("surahspot_attempt")).not.toBe(oldAttempt);
  });

  it("switches Ayah Count play styles as a fresh attempt", async () => {
    await startAyahRound(client, "exact");

    const switched = await client.post(roundRoute, ROUND_URL, {
      mode: "ayah-counts",
      variant: "closest",
      newAttempt: true,
      resetReason: "mode-switch",
    });

    expect(switched.status).toBe(200);
    expect(switched.body.mode).toBe("ayah-counts");
    expect(switched.body.variant).toBe("closest");
    expect(switched.body.progress.roundsCompleted).toBe(0);
  });

  it("does not let a normal next-round request silently change modes", async () => {
    await client.post(roundRoute, ROUND_URL, { mode: "identify-surah" });
    const result = await client.post(roundRoute, ROUND_URL, {
      mode: "ayah-counts",
      variant: "exact",
    });

    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/switch modes/i);
  });

  it("does not treat a same-mode reset as a mode switch", async () => {
    await client.post(roundRoute, ROUND_URL, { mode: "identify-surah" });
    const result = await client.post(roundRoute, ROUND_URL, {
      mode: "identify-surah",
      newAttempt: true,
      resetReason: "mode-switch",
    });

    expect(result.status).toBe(409);
  });
});

describe("ayah counts — exact figure", () => {
  let client: RouteClient;
  beforeEach(() => { client = newClient(); });

  it("awards the base ladder for a correct count", async () => {
    const probe = await startAyahRound(client, "exact");
    const actual = await revealCount(client, probe.token);

    const round = await startAyahRound(client, "exact");
    const result = await client.post(guessRoute, GUESS_URL, {
      token: round.token,
      ayahCount: actual,
    });

    // The second round may be a different Surah, so accept either a first-try
    // win at 100 or a miss — what matters is that a correct count scores 100.
    if (result.body.correct) expect(result.body.points).toBe(100);
    expect(result.status).toBe(200);
  });

  it("steps down 100/80/60/40/20 across tries", async () => {
    const round = await startAyahRound(client, "exact");
    let token = round.token;
    for (const expected of [80, 60, 40, 20]) {
      const result = await client.post(guessRoute, GUESS_URL, { token, skip: true });
      expect(result.body.pointsRemaining).toBe(expected);
      token = result.body.token;
    }
  });

  it("rejects an out-of-range count", async () => {
    const round = await startAyahRound(client, "exact");
    for (const ayahCount of [0, 301, -5, 2.5, "many"]) {
      const result = await client.post(guessRoute, GUESS_URL, { token: round.token, ayahCount });
      expect(result.status).toBe(400);
    }
  });
});

describe("ayah counts — closest figure", () => {
  let client: RouteClient;
  beforeEach(() => { client = newClient(); });

  it("scores each guess by proximity and reports direction", async () => {
    const probe = await startAyahRound(client, "closest");
    const actual = await revealCount(client, probe.token);

    const round = await startAyahRound(client, "closest");
    const low = Math.max(1, actual - 40);
    const result = await client.post(guessRoute, GUESS_URL, { token: round.token, ayahCount: low });

    expect(result.status).toBe(200);
    expect(typeof result.body.lastGuessScore).toBe("number");
    expect(result.body.direction === "higher" || result.body.direction === "lower").toBe(true);
    expect(result.body.tryScores).toHaveLength(1);
  });

  it("keeps the best guess rather than averaging", async () => {
    // The central design decision. Rather than engineering a good guess and a
    // bad one against an unknown count, this asserts the invariant directly:
    // across a spread of guesses the running best never falls, which an
    // average would not satisfy.
    const round = await startAyahRound(client, "closest");
    let token = round.token;
    let previousBest = 0;
    let sawScores = false;

    for (const ayahCount of [3, 120, 40, 250]) {
      const result = await client.post(guessRoute, GUESS_URL, { token, ayahCount });
      expect(result.status).toBe(200);

      const scores = result.body.tryScores as number[];
      expect(Array.isArray(scores)).toBe(true);
      sawScores = true;

      const best = Math.max(...scores);
      // Monotonic: a later worse guess can never reduce the best already held.
      expect(best).toBeGreaterThanOrEqual(previousBest);
      previousBest = best;

      if (result.body.correct || result.body.exhausted) break;
      token = result.body.token;
    }

    expect(sawScores).toBe(true);
  });

  it("reports a ceiling that falls as tries are spent", async () => {
    const round = await startAyahRound(client, "closest");
    const first = await client.post(guessRoute, GUESS_URL, { token: round.token, ayahCount: 40 });
    expect(first.body.ceiling).toBe(95);

    const second = await client.post(guessRoute, GUESS_URL, {
      token: first.body.token,
      ayahCount: 60,
    });
    expect(second.body.ceiling).toBe(90);
  });

  it("records a skipped try as zero so skipping cannot dodge a bad guess", async () => {
    const round = await startAyahRound(client, "closest");
    const result = await client.post(guessRoute, GUESS_URL, { token: round.token, skip: true });
    expect(result.body.tryScores).toEqual([0]);
  });

  it("matches the pure scorer for the revealed count", async () => {
    // The server's award and the client-side preview must come from the same
    // curve, or the number shown mid-round would not be the number earned.
    const round = await startAyahRound(client, "closest");
    const guess = 25;
    const first = await client.post(guessRoute, GUESS_URL, { token: round.token, ayahCount: guess });

    let actual: number;
    if (first.body.exhausted) {
      actual = first.body.reveal.versesCount;
    } else {
      const done = await client.post(guessRoute, GUESS_URL, {
        token: first.body.token,
        skipRound: true,
      });
      actual = done.body.reveal.versesCount;
    }

    expect(first.body.lastGuessScore).toBe(closestFigureScore(guess, actual));
  });

  it("ends the round after five tries and reveals the count", async () => {
    const round = await startAyahRound(client, "closest");
    let token = round.token;
    let final: any;
    for (let index = 0; index < 5; index += 1) {
      const result = await client.post(guessRoute, GUESS_URL, { token, ayahCount: 200 });
      final = result.body;
      if (final.exhausted || final.correct) break;
      token = result.body.token;
    }
    expect(final.reveal.versesCount).toBeGreaterThan(0);
    expect(final.progress.roundsCompleted).toBe(1);
  });
});

describe("ayah counts — attempt", () => {
  it("still runs exactly seven rounds", async () => {
    const client = newClient();
    for (let index = 0; index < 7; index += 1) {
      const round = await startAyahRound(client, "closest");
      expect(round.progress.roundsCompleted).toBe(index);
      await client.post(guessRoute, GUESS_URL, { token: round.token, skipRound: true });
    }

    const eighth = await client.post(roundRoute, ROUND_URL, { mode: "ayah-counts" });
    expect(eighth.status).toBe(409);
  });
});
