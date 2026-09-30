import type { Metadata } from "next";

import { SitePage } from "@/components/site/SitePage";
import { DhikrHero } from "@/components/site/DhikrHero";

export const metadata: Metadata = {
  alternates: { canonical: "/dhikr-duas" },
  title: "Dhikr & Duas — SurahSpot",
  description:
    "Organize daily dhikr and dua study with links to trusted source collections.",
};

type RoutineSource = {
  label: string;
  href: string;
};

type Routine = {
  /** Anchor for the card, so a reminder can open the page at its routine. */
  id: string;
  title: string;
  copy: string;
  sources: readonly RoutineSource[];
};

const ROUTINES: readonly Routine[] = [
  {
    id: "morning-evening",
    title: "Morning & evening",
    copy:
      "Build a consistent start and close to the day with a small, repeatable set.",
    sources: [
      {
        label: "Morning & evening adhkar",
        href: "https://sunnah.com/hisn/75",
      },
    ],
  },

  {
    id: "after-salah",
    title: "After salah",
    copy:
      "Keep post-prayer remembrance separate so it can become a dependable routine.",
    sources: [
      {
        label: "Adhkar after salah",
        href: "https://sunnah.com/hisn/66",
      },
    ],
  },

  {
    id: "sleep-waking",
    title: "Sleep & waking",
    copy:
      "Group the duas around the moments you already repeat every day.",
    sources: [
      {
        label: "Before sleeping",
        href: "https://sunnah.com/hisn/100",
      },
      {
        label: "Upon waking",
        href: "https://sunnah.com/hisn/1",
      },
    ],
  },

  {
    id: "travel-leaving-home",
    title: "Travel & leaving home",
    copy:
      "Keep situational duas easy to find before you need them.",
    sources: [
      {
        label: "Leaving the home",
        href: "https://sunnah.com/hisn/16",
      },
      {
        label: "Travel dua",
        href: "https://sunnah.com/hisn/208",
      },
    ],
  },

  {
    id: "gratitude-seeking-help",
    title: "Gratitude & seeking help",
    copy:
      "Return to remembrance with attention to gratitude, reliance, and asking Allah for ease.",
    sources: [
      {
        label: "Gratitude",
        href: "https://sunnah.com/hisn/82",
      },
      {
        label: "Seeking ease",
        href: "https://sunnah.com/hisn/140",
      },
    ],
  },

  {
    id: "quranic-duas",
    title: "Qur’anic duas",
    copy:
      "Study supplications found in the Qur’an alongside their verses, meanings, and themes.",
    sources: [
      {
        label: "Explore Qur’anic duas",
        href: "https://quran.com/duas/topics",
      },
    ],
  },
];

export default function DhikrDuasPage() {
  return (
    <SitePage>
      {/* =====================================================
          Hero
          ===================================================== */}

      <DhikrHero />


      {/* =====================================================
          Routine categories
          ===================================================== */}

      <section className="content-section">
        <div className="section-heading">
          <p className="eyebrow">
            BUILD A ROUTINE
          </p>

          <h2>
            Organize by the moment you&rsquo;ll remember it.
          </h2>
        </div>

        <div className="resource-card-grid">
          {ROUTINES.map((routine, index) => (
            <article
              className="resource-card dhikr-resource-card"
              id={routine.id}
              key={routine.id}
            >
              <div className="resource-card-content">
                <span className="resource-card-number">
                  {String(index + 1).padStart(2, "0")}
                </span>

                <h3>
                  {routine.title}
                </h3>

                <p>
                  {routine.copy}
                </p>
              </div>


              {/* ---------------------------------------------
                  Trusted source links
                  --------------------------------------------- */}

              <div
                className="dhikr-source-links"
                aria-label={`${routine.title} trusted sources`}
              >
                {routine.sources.map((source) => (
                  <a
                    key={source.href}
                    href={source.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="dhikr-source-link"
                  >
                    <span>
                      {source.label}
                    </span>

                    <span
                      className="dhikr-source-arrow"
                      aria-hidden="true"
                    >
                      ↗
                    </span>
                  </a>
                ))}
              </div>


              {/* ---------------------------------------------
                  Source credit
                  --------------------------------------------- */}

              <div className="dhikr-source-credit">
                {routine.title === "Qur’anic duas"
                  ? "Quran.com"
                  : "Hisn al-Muslim · Sunnah.com"}
              </div>
            </article>
          ))}
        </div>
      </section>


      {/* =====================================================
          Trusted collections
          ===================================================== */}

      <section className="trusted-panel">
        <div>
          <p className="eyebrow">
            READ FROM THE SOURCE
          </p>

          <h2>
            Continue with trusted collections.
          </h2>

          <p>
            Sources open in a new tab, so you can come
            back to where you left off.
          </p>
        </div>


        <div className="trusted-links">
          <a
            href="https://quran.com/duas"
            target="_blank"
            rel="noopener noreferrer"
          >
            <b>
              Duas from the Qur&rsquo;an
            </b>

            <span>
              Quran.com ↗
            </span>
          </a>


          <a
            href="https://sunnah.com/hisn"
            target="_blank"
            rel="noopener noreferrer"
          >
            <b>
              Fortress of the Muslim
            </b>

            <span>
              Sunnah.com ↗
            </span>
          </a>
        </div>
      </section>
    </SitePage>
  );
}