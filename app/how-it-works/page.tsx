import type { Metadata } from "next";
import Link from "next/link";

import { SitePage } from "@/components/site/SitePage";
import { HowItWorksHero } from "@/components/how-it-works/HowItWorksHero";
import { ClosestFigureExplainer } from "@/components/how-it-works/ClosestFigureExplainer";

export const metadata: Metadata = {
  alternates: { canonical: "/how-it-works" },
  title: "How SurahSpot Works",
  description:
    "Learn how SurahSpot’s game modes and Learning Blocks support recognition, recall, estimation, sequencing, and memorization practice.",
};

export default function HowItWorksPage() {
  return (
    <SitePage>
      <HowItWorksHero />

      <section className="process-strip" aria-label="Game flow">
        {[
          [
            "01",
            "Receive a prompt",
            "Hear a full Ayah, see a Surah name, or continue a short passage.",
          ],
          [
            "02",
            "Recall, estimate, or complete",
            "Use what you know and give the prompt a try before moving on.",
          ],
          [
            "03",
            "Get precise feedback",
            "Wrong guesses cost a try; some modes also give directional or positional feedback.",
          ],
          [
            "04",
            "Learn from the reveal",
            "Use the answer and score as an anchor for the next time you meet it.",
          ],
        ].map(([number, title, copy]) => (
          <article key={number}>
            <span>{number}</span>
            <h2>{title}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </section>

      <section className="content-section" id="modes">
        <div className="section-heading">
          <p className="eyebrow">
            FOUR WAYS TO PRACTICE
          </p>

          <h2>
            Choose what you want to strengthen.
          </h2>
        </div>

        <div className="mode-explain-grid">
          <article className="mode-explain-card featured">
            <span className="mode-kicker">
              LISTENING · RECOGNITION
            </span>

            <h3>Identify the Surah</h3>

            <p>
              A complete Ayah is recited. Search the Surah
              catalog and identify where it belongs in up
              to five tries.
            </p>

            <ul>
              <li>
                Five-try ladder: 100 / 80 / 60 / 40 / 20
              </li>
              <li>
                Two hints across the full attempt
              </li>
              <li>
                First hint is free; the second costs 3
                points
              </li>
              <li>
                Seven rounds per attempt
              </li>
            </ul>
          </article>

          <article className="mode-explain-card">
            <span className="mode-kicker">
              MEMORY · ESTIMATION
            </span>

            <h3>Ayah Counts</h3>

            <p>
              See a Surah and recall how many Ayahs it
              contains. Switch between a strict answer
              and an estimation-first style.
            </p>

            <div className="variant-explain">
              <div>
                <b>Exact Figure</b>
                <span>
                  Land on the exact count within five
                  tries.
                </span>
              </div>

              <div>
                <b>Closest Figure</b>
                <span>
                  Use higher/lower feedback and earn
                  points for how close your best
                  estimate gets.
                </span>
              </div>
            </div>
          </article>

          <article className="mode-explain-card completion-explain-card">
            <span className="mode-kicker">
              RECALL · ORDER
            </span>

            <h3>Completion</h3>

            <p>
              Read a short block of one to three Ayahs
              and work out what comes next. Choose the
              next Ayah, or rebuild the following sequence
              in the right order.
            </p>

            <div className="variant-explain">
              <div>
                <b>Fill-in</b>
                <span>
                  Pick the next Ayah from five choices.
                  One choice continues the passage.
                </span>
              </div>

              <div>
                <b>Sequence</b>
                <span>
                  Arrange two to five following Ayahs in
                  order. Correct positions lock as you go.
                </span>
              </div>
            </div>

            <p className="mode-explain-note">
              Both versions use seven rounds, five tries,
              and no hints. Audio, karaoke, transliteration,
              and translation stay available with the passage.
            </p>
          </article>

          <article className="mode-explain-card learning-blocks-explain-card">
            <span className="mode-kicker">
              STUDY · MEMORIZATION
            </span>

            <h3>Learning Blocks</h3>

            <p>
              Move through the Qur’an page by page in book or scrolling view, then hide what you want to recall. There is no score, timer, or attempt limit.
            </p>

            <div className="variant-explain">
              <div>
                <b>Hide and reveal</b>
                <span>
                  Hide a whole page, tap individual Ayahs, press and glide across 5–10 Ayahs, or type an Ayah range.
                </span>
              </div>

              <div>
                <b>Sequence practice</b>
                <span>
                  Turn a hidden 5–10 Ayah block into a shuffled Ayah bank, then tap or drag the Ayahs back into the correct order.
                </span>
              </div>
            </div>

            <p className="mode-explain-note">
              Switch between Mushaf, Ayah + translation, and translation-only reading. Your reader preferences and hidden blocks stay on this device.
            </p>

            <Link className="secondary content-cta learning-blocks-link" href="/learning-blocks">
              Open Learning Blocks
            </Link>
          </article>
        </div>
      </section>

      <section className="content-section scoring-section">
        <div className="section-heading compact">
          <p className="eyebrow">
            SCORING WITHOUT MYSTERY
          </p>

          <h2>
            Every choice has a visible cost.
          </h2>

          <p>
            Your game rules stay the same, even if you refresh or continue on another device.
          </p>
        </div>

        <div className="score-story">
          {[100, 80, 60, 40, 20].map(
            (score, index) => (
              <div key={score}>
                <span>Try {index + 1}</span>
                <b>{score}</b>
                <small>points</small>
              </div>
            )
          )}
        </div>

        <div className="learning-note">
          <b>
            Game modes use fresh attempts. Learning Blocks does not.
          </b>

          <p>
            Recognition, Ayah Counts, and Completion keep their seven-round scoring. Learning Blocks stays open-ended so you can study without a timer or score.
          </p>
        </div>
      </section>

       <ClosestFigureExplainer />

      <section className="final-cta-panel">
        <div>
          <p className="eyebrow">
            READY WHEN YOU ARE
          </p>

          <h2>
            One round is enough to begin.
          </h2>
        </div>

        <Link
          className="primary content-cta"
          href="/"
        >
          Play SurahSpot
        </Link>
      </section>
    </SitePage>
  );
}