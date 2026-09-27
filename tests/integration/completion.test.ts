import { beforeEach, describe, expect, it } from "vitest";
import { RouteClient } from "../helpers/route-client";
import { POST as roundRoute } from "@/app/api/quran/round/route";
import { POST as guessRoute } from "@/app/api/game/guess/route";
import { POST as hintRoute } from "@/app/api/game/hint/route";
import { openRound } from "@/lib/quran/round-token";
import { resetCatalogCache } from "@/lib/quran/catalog";
import { resetRoundBuilderCaches } from "@/lib/game/round-builder";

const ROUND_URL = "http://localhost:3000/api/quran/round";
const GUESS_URL = "http://localhost:3000/api/game/guess";
const HINT_URL = "http://localhost:3000/api/game/hint";

/**
 * Sequence difficulty over the seven-round attempt.
 *
 * Round 1 → 2 Ayahs
 * Round 2 → 3 Ayahs
 * Round 3 → 4 Ayahs
 * Round 4 → 5 Ayahs
 * Round 5 → 5 Ayahs
 * Round 6 → 5 Ayahs
 * Round 7 → 5 Ayahs
 */
const EXPECTED_SEQUENCE_SIZES = [2, 3, 4, 5, 5, 5, 5] as const;

function newClient() {
  resetCatalogCache();
  resetRoundBuilderCaches();

  return new RouteClient();
}

async function startCompletion(
  client: RouteClient,
  variant: "fill-in" | "sequence",
) {
  const result = await client.post(
    roundRoute,
    ROUND_URL,
    {
      mode: "completion",
      variant,
      language: "english",
    },
  );

  expect(result.status).toBe(200);

  return result.body;
}

/* ==========================================================================
   COMPLETION — FILL-IN
   ========================================================================== */

describe("completion — fill-in", () => {
  let client: RouteClient;

  beforeEach(() => {
    client = newClient();
  });

  it(
    "shows a 1–3 Ayah block, five choices, and no hints without exposing the answer",
    async () => {
      const round = await startCompletion(
        client,
        "fill-in",
      );

      expect(round.mode).toBe("completion");
      expect(round.variant).toBe("fill-in");

      expect(round.surah.nameSimple).toBeTruthy();
      expect(round.surah.versesCount).toBeGreaterThan(1);

      /**
       * Completion's provided passage is always randomly
       * selected between 1 and 3 Ayahs.
       */
      expect(
        round.completion.prompt.length,
      ).toBeGreaterThanOrEqual(1);

      expect(
        round.completion.prompt.length,
      ).toBeLessThanOrEqual(3);

      /**
       * The shown passage must never equal the complete Surah.
       */
      expect(
        round.completion.prompt.length,
      ).toBeLessThan(
        round.surah.versesCount,
      );

      /**
       * Fill-in hides exactly one proceeding Ayah.
       */
      expect(
        round.completion.blankCount,
      ).toBe(1);

      /**
       * The visible prompt plus the hidden answer must
       * fit completely inside the source Surah.
       */
      expect(
        round.completion.prompt.length +
          round.completion.blankCount,
      ).toBeLessThanOrEqual(
        round.surah.versesCount,
      );

      /**
       * Fill-in has exactly five answer choices:
       *
       * 1 correct
       * 4 distractors
       */
      expect(
        round.completion.choices,
      ).toHaveLength(5);

      expect(
        new Set(
          round.completion.choices.map(
            (choice: { id: string }) => choice.id,
          ),
        ).size,
      ).toBe(5);

      /**
       * Completion modes have no hints.
       */
      expect(round.hints).toBeUndefined();

      /**
       * Existing audio/karaoke data must remain available.
       */
      expect(
        round.audio.segments.length,
      ).toBeGreaterThan(0);

      /**
       * Correct answers and source verse keys remain
       * sealed inside the round token.
       *
       * They must not be exposed in the normal API payload.
       */
      const serialized = JSON.stringify(round);

      expect(serialized).not.toMatch(
        /completionCorrectChoiceIds/,
      );

      expect(serialized).not.toMatch(
        /completionPromptVerseKeys/,
      );

      expect(serialized).not.toMatch(
        /completionTargetVerseKeys/,
      );

      expect(serialized).not.toMatch(
        /"verseKey"/,
      );
    },
  );

  it(
    "keeps the standard five-try score ladder and awards 100 on a first-try answer",
    async () => {
      const round = await startCompletion(
        client,
        "fill-in",
      );

      const sealed = openRound(round.token);

      const answer =
        sealed.completionCorrectChoiceIds?.[0];

      expect(answer).toBeTruthy();

      const result = await client.post(
        guessRoute,
        GUESS_URL,
        {
          token: round.token,
          completionChoiceId: answer,
        },
      );

      expect(result.status).toBe(200);

      expect(result.body.correct).toBe(true);
      expect(result.body.points).toBe(100);

      expect(
        result.body.correctChoiceIds,
      ).toEqual([answer]);

      expect(
        result.body.progress.roundsCompleted,
      ).toBe(1);
    },
  );

  it(
    "returns only positional feedback after a miss and steps to 80 points",
    async () => {
      const round = await startCompletion(
        client,
        "fill-in",
      );

      const sealed = openRound(round.token);

      const answer =
        sealed.completionCorrectChoiceIds?.[0];

      expect(answer).toBeTruthy();

      const wrong =
        round.completion.choices.find(
          (choice: { id: string }) =>
            choice.id !== answer,
        )?.id;

      expect(wrong).toBeTruthy();

      const result = await client.post(
        guessRoute,
        GUESS_URL,
        {
          token: round.token,
          completionChoiceId: wrong,
        },
      );

      expect(result.status).toBe(200);

      expect(result.body.correct).toBe(false);
      expect(result.body.exhausted).toBe(false);

      expect(
        result.body.correctPositions,
      ).toEqual([false]);

      /**
       * Do not reveal the correct answer after an ordinary miss.
       */
      expect(
        result.body.correctChoiceIds,
      ).toBeUndefined();

      /**
       * Five tries total:
       *
       * first miss → four tries remaining
       * 100 → 80 points available
       */
      expect(
        result.body.attemptsRemaining,
      ).toBe(4);

      expect(
        result.body.pointsRemaining,
      ).toBe(80);

      /**
       * A wrong answer rotates the token so the stale
       * pre-guess token cannot be replayed.
       */
      expect(result.body.token).toBeTruthy();
      expect(result.body.token).not.toBe(
        round.token,
      );
    },
  );

  it(
    "refuses hint requests",
    async () => {
      const round = await startCompletion(
        client,
        "fill-in",
      );

      const result = await client.post(
        hintRoute,
        HINT_URL,
        {
          token: round.token,
          type: "juz",
        },
      );

      expect(result.status).toBe(400);

      expect(result.body.error).toMatch(
        /not available in this mode/i,
      );
    },
  );
});

/* ==========================================================================
   COMPLETION — SEQUENCE
   ========================================================================== */

describe("completion — sequence", () => {
  let client: RouteClient;

  beforeEach(() => {
    client = newClient();
  });

  it(
    "progresses from two through five Ayahs to order while keeping the provided block between one and three Ayahs",
    async () => {
      for (
        let index = 0;
        index < EXPECTED_SEQUENCE_SIZES.length;
        index += 1
      ) {
        const round = await startCompletion(
          client,
          "sequence",
        );

        const expectedSequenceSize =
          EXPECTED_SEQUENCE_SIZES[index];

        /**
         * Make sure we're actually advancing through
         * the seven-round attempt.
         */
        expect(
          round.progress.roundsCompleted,
        ).toBe(index);

        expect(
          round.completion.difficultyLevel,
        ).toBe(index);

        /**
         * Sequence progression:
         *
         * 2 → 3 → 4 → 5 → 5 → 5 → 5
         */
        expect(
          round.completion.blankCount,
        ).toBe(expectedSequenceSize);

        /**
         * Sequence has exactly one bank item for every
         * Ayah that needs to be ordered.
         */
        expect(
          round.completion.choices,
        ).toHaveLength(
          expectedSequenceSize,
        );

        expect(
          new Set(
            round.completion.choices.map(
              (choice: { id: string }) =>
                choice.id,
            ),
          ).size,
        ).toBe(expectedSequenceSize);

        /**
         * Both Completion variants use the same
         * randomly selected 1–3 Ayah prompt rule.
         */
        expect(
          round.completion.prompt.length,
        ).toBeGreaterThanOrEqual(1);

        expect(
          round.completion.prompt.length,
        ).toBeLessThanOrEqual(3);

        /**
         * Never show the complete Surah.
         */
        expect(
          round.completion.prompt.length,
        ).toBeLessThan(
          round.surah.versesCount,
        );

        /**
         * The provided passage and every proceeding Ayah
         * in the sequence must fit inside the Surah.
         */
        expect(
          round.completion.prompt.length +
            round.completion.blankCount,
        ).toBeLessThanOrEqual(
          round.surah.versesCount,
        );

        /**
         * Sequence also retains audio/karaoke support.
         */
        expect(
          round.audio.segments.length,
        ).toBeGreaterThan(0);

        /**
         * Completion modes do not expose hints.
         */
        expect(
          round.hints,
        ).toBeUndefined();

        /**
         * Finish this round so the next request advances
         * to the next difficulty level.
         */
        const skipped = await client.post(
          guessRoute,
          GUESS_URL,
          {
            token: round.token,
            skipRound: true,
          },
        );

        expect(skipped.status).toBe(200);

        /**
         * A completed/skipped round may reveal the answer.
         * Its size should exactly match the number of
         * Ayahs that belonged in the sequence.
         */
        expect(
          skipped.body.correctChoiceIds,
        ).toHaveLength(
          expectedSequenceSize,
        );
      }
    },
  );

  it(
    "returns Wordle-style positional feedback, then scores the corrected order",
    async () => {
      /**
       * Round 1 now starts with two Ayahs, so we can test
       * ordering immediately without skipping a round first.
       */
      const round = await startCompletion(
        client,
        "sequence",
      );

      expect(
        round.completion.blankCount,
      ).toBe(2);

      expect(
        round.completion.choices,
      ).toHaveLength(2);

      const sealed = openRound(round.token);

      const expected =
        sealed.completionCorrectChoiceIds ?? [];

      expect(expected).toHaveLength(2);

      /**
       * IDs are unique, so reversing a two-item sequence
       * guarantees that both positions are incorrect.
       */
      const wrongOrder = [
        ...expected,
      ].reverse();

      const wrong = await client.post(
        guessRoute,
        GUESS_URL,
        {
          token: round.token,
          completionOrder: wrongOrder,
        },
      );

      expect(wrong.status).toBe(200);

      expect(wrong.body.correct).toBe(false);
      expect(wrong.body.exhausted).toBe(false);

      expect(
        wrong.body.correctPositions,
      ).toEqual([
        false,
        false,
      ]);

      /**
       * An ordinary wrong attempt returns positional
       * feedback without revealing the answer order.
       */
      expect(
        wrong.body.correctChoiceIds,
      ).toBeUndefined();

      expect(
        wrong.body.attemptsRemaining,
      ).toBe(4);

      expect(
        wrong.body.pointsRemaining,
      ).toBe(80);

      /**
       * Wrong submissions rotate the round token.
       */
      expect(wrong.body.token).toBeTruthy();

      expect(wrong.body.token).not.toBe(
        round.token,
      );

      /**
       * Submit the proper order with the rotated token.
       */
      const corrected = await client.post(
        guessRoute,
        GUESS_URL,
        {
          token: wrong.body.token,
          completionOrder: expected,
        },
      );

      expect(corrected.status).toBe(200);

      expect(
        corrected.body.correct,
      ).toBe(true);

      /**
       * One failed try means the successful second
       * submission earns 80 points.
       */
      expect(
        corrected.body.points,
      ).toBe(80);

      expect(
        corrected.body.correctPositions,
      ).toEqual([
        true,
        true,
      ]);

      expect(
        corrected.body.correctChoiceIds,
      ).toEqual(expected);
    },
  );

  it(
    "requires every sequence slot to be filled before submit",
    async () => {
      const round = await startCompletion(
        client,
        "sequence",
      );

      expect(
        round.completion.blankCount,
      ).toBe(2);

      const oneChoice =
        round.completion.choices[0].id;

      const result = await client.post(
        guessRoute,
        GUESS_URL,
        {
          token: round.token,

          /**
           * Round 1 requires two items, but deliberately
           * submit only one.
           */
          completionOrder: [
            oneChoice,
          ],
        },
      );

      expect(result.status).toBe(400);

      expect(result.body.error).toMatch(
        /place all 2 Ayahs/i,
      );
    },
  );

  it(
    "refuses hint requests",
    async () => {
      const round = await startCompletion(
        client,
        "sequence",
      );

      const result = await client.post(
        hintRoute,
        HINT_URL,
        {
          token: round.token,
          type: "juz",
        },
      );

      expect(result.status).toBe(400);

      expect(result.body.error).toMatch(
        /not available in this mode/i,
      );
    },
  );
});