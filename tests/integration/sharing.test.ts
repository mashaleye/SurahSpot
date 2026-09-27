import { beforeEach, describe, expect, it } from "vitest";
import { RouteClient } from "../helpers/route-client";
import { POST as roundRoute } from "@/app/api/quran/round/route";
import { POST as guessRoute } from "@/app/api/game/guess/route";
import { POST as shareResultRoute } from "@/app/api/share/result/route";
import { POST as shareVerseRoute } from "@/app/api/share/verse/route";
import { openShareResult } from "@/lib/share/result-token";
import { resetCatalogCache } from "@/lib/quran/catalog";
import { resetRoundBuilderCaches } from "@/lib/game/round-builder";

const ROUND_URL = "http://localhost:3000/api/quran/round";
const GUESS_URL = "http://localhost:3000/api/game/guess";
const SHARE_RESULT_URL = "http://localhost:3000/api/share/result";
const SHARE_VERSE_URL = "http://localhost:3000/api/share/verse";

function newClient() {
  resetCatalogCache();
  resetRoundBuilderCaches();
  return new RouteClient();
}

describe("sharing", () => {
  let client: RouteClient;
  beforeEach(() => { client = newClient(); });

  it("creates a public result only after seven rounds and keeps answers out of it", async () => {
    let lastRound: any;
    for (let index = 0; index < 7; index += 1) {
      lastRound = (await client.post(roundRoute, ROUND_URL, {
        mode: "identify-surah",
        language: "english",
      })).body;
      const skipped = await client.post(guessRoute, GUESS_URL, {
        token: lastRound.token,
        skipRound: true,
      });
      expect(skipped.status).toBe(200);
    }

    const shared = await client.post(shareResultRoute, SHARE_RESULT_URL, {});
    expect(shared.status).toBe(200);
    expect(shared.body.path).toMatch(/^\/r\//);
    expect(shared.body.cardPath).toMatch(/^\/api\/share\/card\/result\//);
    expect(shared.body.textTemplate).toMatch(/SurahSpot/);

    const token = decodeURIComponent(String(shared.body.path).replace(/^\/r\//, ""));
    const result = openShareResult(token);
    expect(result.roundsPlayed).toBe(7);
    expect(result.roundStates).toHaveLength(7);
    expect(JSON.stringify(result)).not.toMatch(/chapter|verse|answer|correctChoice|sequence/i);
  });

  it("does not create a result share before the attempt is complete", async () => {
    const round = await client.post(roundRoute, ROUND_URL, {
      mode: "identify-surah",
      language: "english",
    });
    expect(round.status).toBe(200);
    const shared = await client.post(shareResultRoute, SHARE_RESULT_URL, {});
    expect(shared.status).toBe(409);
  });

  it("refuses verse sharing during a live recognition round and allows it after reveal", async () => {
    const round = await client.post(roundRoute, ROUND_URL, {
      mode: "identify-surah",
      language: "english",
    });
    expect(round.status).toBe(200);

    const early = await client.post(shareVerseRoute, SHARE_VERSE_URL, {
      token: round.body.token,
      language: "english",
    });
    expect(early.status).toBe(409);

    const finished = await client.post(guessRoute, GUESS_URL, {
      token: round.body.token,
      skipRound: true,
    });
    expect(finished.status).toBe(200);

    const shared = await client.post(shareVerseRoute, SHARE_VERSE_URL, {
      token: round.body.token,
      language: "english",
    });
    expect(shared.status).toBe(200);
    expect(shared.body.path).toMatch(/^\/v\//);
    expect(shared.body.cardPath).toMatch(/^\/api\/share\/card\/verse\//);
    expect(shared.body.textTemplate).toMatch(/Fixture translation/i);
  });
});
