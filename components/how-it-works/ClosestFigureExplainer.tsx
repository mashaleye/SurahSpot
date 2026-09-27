import { closestFigureScore } from "@/lib/game/scoring-ayah-count";

const WORKED_GUESSES: readonly number[] = [120, 90, 80];
const WORKED_ACTUAL: number = 78;

export function ClosestFigureExplainer() {
  const workedScores = WORKED_GUESSES.map((guess) => ({
    guess,
    score: closestFigureScore(guess, WORKED_ACTUAL),
    direction:
      guess === WORKED_ACTUAL
        ? "Exact"
        : guess < WORKED_ACTUAL
          ? "Higher"
          : "Lower",
  }));

  const best = Math.max(...workedScores.map((item) => item.score));

  const roundScore = Math.max(
    0,
    best - 5 * (workedScores.length - 1),
  );

  return (
    <section
      className="closest-figure-explainer"
      aria-labelledby="closest-figure-blog-title"
    >
      <div className="closest-figure-explainer-head">
        <div className="closest-figure-explainer-copy">
          <p className="eyebrow">BEHIND THE SCORE</p>

          <h2 id="closest-figure-blog-title">
            <span>How Closest Figure</span>
            <em>turns an estimate into points.</em>
          </h2>

          <p className="closest-figure-explainer-intro">
            A friendly look at the formula, why the curve is shaped the way it
            is, and how short and long Surahs stay fair.
          </p>
        </div>

        <a
          className="closest-figure-pdf-link"
          href="/docs/surahspot-closest-figure-scoring.pdf"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>Read as PDF</span>
          <span aria-hidden="true">↗</span>
        </a>
      </div>

      <details className="closest-figure-details">
        <summary>
          <span className="closest-figure-summary-copy">
            <b>Read the full explanation</b>

            <small>
              Formula, edge cases, examples, design decisions, and implementation
            </small>
          </span>

          <span
            className="closest-figure-summary-icon"
            aria-hidden="true"
          >
            <span className="closest-figure-icon-line closest-figure-icon-line-horizontal" />
            <span className="closest-figure-icon-line closest-figure-icon-line-vertical" />
          </span>
        </summary>

        <article className="closest-figure-article">
          <p className="closest-figure-lead">
            Exact Figure asks, “Do you know the count?” Closest Figure asks a
            slightly different question: “How good is your estimate, and can
            you improve it using feedback?” Because of that, a near miss should
            not be treated the same way as a random guess.
          </p>

          <h3>1. Measure the distance</h3>

          <p>
            Let <code>a</code> be the actual number of Ayahs and{" "}
            <code>g</code> be the player&apos;s guess. The raw distance is:
          </p>

          <div className="closest-figure-formula">
            d = |g - a|
          </div>

          <h3>2. Scale that distance to the Surah</h3>

          <p>
            Ten Ayahs away means very different things on a 286-Ayah Surah and
            a 3-Ayah Surah. Closest Figure therefore uses a tolerance window
            based on the Surah&apos;s own size:
          </p>

          <div className="closest-figure-formula">
            T = max(3, 0.5 × a)
          </div>

          <p>
            Normally the tolerance is half of the true count. The minimum of
            three protects very short Surahs from becoming disproportionately
            harsh.
          </p>

          <h3>3. Convert the miss into normalized error</h3>

          <div className="closest-figure-formula">
            e = d / T
          </div>

          <p>
            This converts “how many Ayahs off?” into a scale that can be
            compared across Surahs of very different lengths.
          </p>

          <h3>4. Apply the scoring curve</h3>

          <div className="closest-figure-formula">
            S = round(100 × (1 - e)<sup>1.5</sup>)
          </div>

          <p>
            An exact guess is always worth 100. If <code>e ≥ 1</code>, the
            guess has moved outside the scoring window and earns zero. The
            exponent <code>1.5</code> makes the curve stricter than a straight
            line, so genuinely close guesses remain valuable while vague
            guesses lose value more quickly.
          </p>

          <div className="closest-figure-callout">
            <b>Why not use a fixed penalty per Ayah?</b>

            <p>
              Because Surahs vary dramatically in length. A miss of ten Ayahs
              can be an excellent estimate for a long Surah and a very poor
              estimate for a short one.
            </p>
          </div>

          <h3>5. Higher and lower create convergence</h3>

          <p>
            When a guess is below the answer, you&rsquo;ll see{" "}
            <b>Higher</b>. When it is above the answer, it responds with{" "}
            <b>Lower</b>. The exact distance remains hidden so the feedback
            narrows the search without solving the round.
          </p>

          <h3>6. The best guess carries the round</h3>

          <p>
            Every try receives its own proximity score. The strongest score is
            kept, then five points are removed for each additional try:
          </p>

          <div className="closest-figure-formula">
            R = max(0, max(S₁, S₂, …, Sₙ) - 5 × (n - 1))
          </div>

          <p>
            Best-of scoring preserves the strongest evidence of knowledge while
            the additional-try cost still rewards reaching the answer
            efficiently.
          </p>

          <h3>7. Worked example</h3>

          <p>
            Suppose the actual count is <b>{WORKED_ACTUAL}</b> Ayahs:
          </p>

          <div className="closest-figure-example-grid">
            {workedScores.map((item, index) => (
              <div key={item.guess}>
                <span>TRY {index + 1}</span>

                <b>{item.guess}</b>

                <small>
                  {item.score} pts · {item.direction}
                </small>
              </div>
            ))}
          </div>

          <p>
            The best single-guess score is <b>{best}</b>. Three tries means two
            additional-try penalties, so the current round value is{" "}
            <b>{roundScore} points</b>.
          </p>

          <h3>8. Edge cases</h3>

          <p>
            The scoring curve is only one part of the system. Closest Figure
            also needs predictable behavior around unusual input, skipping,
            exhausted tries, and repeated requests.
          </p>

          <div className="closest-figure-edge-grid">
            <section>
              <span>INPUT</span>
              <h4>Only whole counts from 1–300 are accepted.</h4>
              <p>
                Zero, negative numbers, decimals, text, and values above 300
                are rejected before they affect the round.
              </p>
            </section>

            <section>
              <span>DEFENSIVE MATH</span>
              <h4>Unexpected numeric state fails safely.</h4>
              <p>
                Non-finite values and impossible actual counts resolve to zero
                instead of propagating NaN or throwing.
              </p>
            </section>

            <section>
              <span>SHORT SURAHS</span>
              <h4>The minimum tolerance protects small counts.</h4>
              <p>
                A one-Ayah miss should matter without becoming
                disproportionately punishing.
              </p>
            </section>

            <section>
              <span>SCORING FLOOR</span>
              <h4>Scores never fall below zero.</h4>
              <p>
                Once the estimate leaves the tolerance window, the proximity
                score simply stops at zero.
              </p>
            </section>

            <section>
              <span>SKIP TRY</span>
              <h4>A skipped try still consumes an attempt.</h4>
              <p>
                It contributes zero to the score history so skipping cannot be
                used to avoid the cost of another try.
              </p>
            </section>

            <section>
              <span>SKIP ROUND</span>
              <h4>Skipping the round ends it for zero.</h4>
              <p>
                Abandoning a round is different from banking the best estimate
                already made.
              </p>
            </section>

            <section>
              <span>REPEATED GUESS</span>
              <h4>Repeating a wrong number is naturally expensive.</h4>
              <p>
                The best score does not improve, but another five-point try
                cost is added.
              </p>
            </section>

            <section>
              <span>FIFTH TRY</span>
              <h4>The final attempt closes the round.</h4>
              <p>
                An exact fifth guess can still score 80; otherwise the final
                best proximity result is settled and the answer is revealed.
              </p>
            </section>

            <section>
              <span>STALE REQUEST</span>
              <h4>One round revision can only score once.</h4>
              <p>
                Double submissions or replayed requests using old state are
                rejected instead of mutating the round twice.
              </p>
            </section>

            <section>
              <span>ANSWER SECRECY</span>
              <h4>The Ayah count remains hidden until reveal.</h4>
              <p>
                The active-round payload does not expose the value being
                estimated.
              </p>
            </section>
          </div>

          <h3>9. Implementation</h3>

          <p>
            The scoring function is deliberately pure: numbers go in and a
            score comes out. That keeps it straightforward to test, reuse, and
            compare between client previews and authoritative server scoring.
          </p>

          <pre className="closest-figure-code">
{`const FALLOFF_EXPONENT = 1.5;
const TOLERANCE_RATIO = 0.5;
const MIN_TOLERANCE = 3;
export const TRY_PENALTY = 5;

export function closestFigureScore(
  guess: number,
  actual: number
) {
  const distance = Math.abs(guess - actual);

  if (distance === 0) return 100;

  const tolerance = Math.max(
    MIN_TOLERANCE,
    actual * TOLERANCE_RATIO
  );

  const error = distance / tolerance;

  if (error >= 1) return 0;

  return Math.round(
    100 *
      Math.pow(
        1 - error,
        FALLOFF_EXPONENT
      )
  );
}`}
          </pre>

          <div className="closest-figure-callout">
            <b>The formula defines the score. The surrounding rules protect its meaning.</b>

            <p>
              Validation, try limits, session state, revision checking, and
              answer secrecy make sure the mathematical model continues to
              behave fairly in real gameplay.
            </p>
          </div>
        </article>
      </details>
    </section>
  );
}