import type { Metadata } from "next";

import Link from "next/link";

import { SitePage } from "@/components/site/SitePage";
import { SurahsHero } from "@/components/site/SurahsHero";
import { TOTAL_AYAHS, TOTAL_SURAHS } from "@/lib/quran/chapters";
import { SURAH_FACTS, surahPath } from "@/lib/quran/surah-facts";

export const metadata: Metadata = {
  alternates: { canonical: "/surahs" },
  title: "Popular & Important Surahs — SurahSpot",
  description:
    "Quick links to commonly revisited Surahs for reading, listening, and building familiarity over time.",
};

const SURAHS = [
  [
  1,
  "Al-Fatihah",
  "الفاتحة",
  "A foundational prayer of praise, guidance, and reliance upon Allah.",
],

[
  2,
  "Al-Baqarah",
  "البقرة",
  "A wide-ranging Surah on faith, law, worship, guidance, and community life.",
],

[
  18,
  "Al-Kahf",
  "الكهف",
  "A Surah of trials, faith, patience, knowledge, and trust in Allah.",
],

[
  36,
  "Ya-Sin",
  "يس",
  "A powerful reminder of revelation, resurrection, and Allah’s signs in creation.",
],

[
  55,
  "Ar-Rahman",
  "الرحمن",
  "A reflection on Allah’s mercy, blessings, creation, and final judgment.",
],

[
  56,
  "Al-Waqi'ah",
  "الواقعة",
  "A vivid depiction of the Last Day and the different ranks of humanity.",
],
  [
  67,
  "Al-Mulk",
  "الملك",
  "A reflection on Allah’s sovereignty, creation, and human accountability.",
],

[
  112,
  "Al-Ikhlas",
  "الإخلاص",
  "A concise declaration of Allah’s absolute oneness and uniqueness.",
],

[
  113,
  "Al-Falaq",
  "الفلق",
  "A prayer seeking Allah’s protection from harm, darkness, and envy.",
],

[
  114,
  "An-Nas",
  "الناس",
  "A prayer seeking Allah’s protection from evil whispers that enter the heart.",
],
] as const;

export default function SurahsPage() {
  return (
    <SitePage>
      {/* Main image hero */}
      <SurahsHero />

      {/* =====================================================
          Popular Surahs intro
          ===================================================== */}

      <section
        className="content-section surahs-library-section"
        aria-labelledby="popular-surahs-heading"
      >
        <div className="surahs-library-heading">
          <p className="eyebrow">
            READ · LISTEN · RECOGNIZE
          </p>

          <h2 id="popular-surahs-heading">
            Popular Surahs
            <br />

            <em>
              Stronger familiarity.
            </em>
          </h2>

          <p>
            Use these commonly revisited chapters as anchors,
            then open any of them in Learning Blocks
            to read the full text with translation,
            at your own pace.
          </p>
        </div>

        {/* ===================================================
            Surah cards
            =================================================== */}

        <div
          className="surah-resource-grid"
          aria-label="Popular and important Surahs"
        >
          {SURAHS.map(
            ([number, name, arabic, copy]) => (
              <Link
                className="surah-resource-card"
                /*
                 * Into SurahSpot's own reader rather than out to Quran.com.
                 * The reader honours ?surah= and still restores wherever the
                 * reader last stopped inside that Surah.
                 */
                href={`/learning-blocks?surah=${number}`}
                key={number}
              >
                <span className="surah-resource-number">
                  {String(number).padStart(3, "0")}
                </span>

                <p
                  lang="ar"
                  dir="rtl"
                >
                  {arabic}
                </p>

                <h2>
                  {name}
                </h2>

                <div>
                  {copy}
                </div>

                <small>
                  Quran (Learning Blocks)
                </small>
              </Link>
            )
          )}
        </div>
      </section>

      {/* =====================================================
          Full index

          Every Surah, in order. Two jobs: it is the page people
          actually want when they know which Surah they are after,
          and it is the only path by which a crawler reaches the
          114 Surah pages — they are held out of the sitemap while
          the domain is new, so internal links are the whole
          discovery route.
          ===================================================== */}

      <section
        className="content-section surah-index-section"
        aria-labelledby="surah-index-heading"
      >
        <div className="surah-index-heading">
          <p className="eyebrow">
            EVERY SURAH
          </p>

          <h2 id="surah-index-heading">
            All {TOTAL_SURAHS} Surahs
            <br />

            <em>
              In order.
            </em>
          </h2>

          <p>
            {TOTAL_AYAHS.toLocaleString("en-US")} Ayahs across {TOTAL_SURAHS} chapters.
            Each one opens a short page with its Ayah count, where it was revealed and
            which Juz it falls in &mdash; and a way straight into the reader.
          </p>
        </div>

        <ol
          className="surah-index"
          aria-label={`All ${TOTAL_SURAHS} Surahs in order`}
        >
          {SURAH_FACTS.map(
            (surah) => (
              <li key={surah.id}>
                <Link href={surahPath(surah)}>
                  <span className="surah-index-number">
                    {surah.id}
                  </span>

                  <span className="surah-index-name">
                    {surah.nameSimple}
                  </span>

                  <span
                    className="surah-index-arabic"
                    lang="ar"
                    dir="rtl"
                  >
                    {surah.nameArabic}
                  </span>

                  {/*
                    The bare number reads as "110" to a screen reader, which
                    beside a Surah name could be anything. The unit is spoken
                    but not drawn, so the column still scans as numbers.
                  */}
                  <span className="surah-index-count">
                    {surah.versesCount}
                    <span className="learning-sr-only">
                      {surah.versesCount === 1 ? " Ayah" : " Ayahs"}
                    </span>
                  </span>
                </Link>
              </li>
            )
          )}
        </ol>
      </section>
    </SitePage>
  );
}