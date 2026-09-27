import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SitePage } from "@/components/site/SitePage";
import { siteOrigin } from "@/lib/config/site";
import { TOTAL_SURAHS } from "@/lib/quran/chapters";
import {
  SURAH_FACTS,
  findSurahBySlug,
  formatJuzSpan,
  surahNeighbours,
  surahPath,
  surahReaderPath,
  type SurahFacts,
} from "@/lib/quran/surah-facts";

/**
 * One page per Surah, carrying the facts people actually search for and the
 * tools this site has for practising that Surah.
 *
 * WHAT THIS PAGE DELIBERATELY IS NOT
 *
 * It does not reproduce the Qur'an text or a translation. A page that did would
 * be a thinner copy of quran.com built from quran.com's own organisation's
 * data, competing against their authority — and 114 of those is the shape
 * Google's scaled-content-abuse policy exists to catch, with a penalty that
 * lands site-wide rather than on the offending pages. Every page here answers
 * questions the reader is a poor way to answer ("how many Ayahs", "which Juz",
 * "Makki or Madani") and then hands the reader over for the text itself.
 *
 * All 114 are prerendered at build time. With `dynamicParams = false` a slug
 * that is not one of them 404s without rendering, so the route cannot be used
 * to spray arbitrary URLs into the index.
 */

export const dynamicParams = false;

export function generateStaticParams() {
  return SURAH_FACTS.map((surah) => ({ slug: surah.slug }));
}

type PageProps = { params: Promise<{ slug: string }> };

/** "the 18th", "the 1st", "the 22nd" — used in prose and in metadata. */
function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

/**
 * Whether the English rendering adds anything to the transliterated name.
 *
 * Six Surahs are named for a person or for the letters they open with — Hud,
 * Luqman, Sad, Muhammad, Qaf, Quraysh — and for those the "meaning" is the name
 * again. Rendering it anyway produces "Hud (Hud)" in the title, the lede and the
 * heading, which is how a templated page announces that it is templated.
 */
function hasDistinctMeaning(surah: SurahFacts): boolean {
  return surah.meaning !== surah.nameSimple;
}

/**
 * The one-sentence description, shared by the page lede and the meta
 * description so the two cannot drift apart.
 */
function describe(surah: SurahFacts): string {
  const named = hasDistinctMeaning(surah)
    ? `Surah ${surah.nameSimple} (${surah.meaning})`
    : `Surah ${surah.nameSimple}`;

  return `${named} is the ${ordinal(surah.id)} chapter of the Qur’an. It has ${
    surah.versesCount
  } ${surah.versesCount === 1 ? "Ayah" : "Ayahs"}, was revealed in ${
    surah.revelationPlace
  }, and falls in ${formatJuzSpan(surah.juz)}.`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const surah = findSurahBySlug(slug);
  if (!surah) return {};

  return {
    /*
     * Self-referencing. Each of these pages carries content the others do not,
     * so consolidating them onto /surahs — or onto the reader — would be
     * telling Google to index none of it.
     */
    alternates: { canonical: surahPath(surah) },

    title: hasDistinctMeaning(surah)
      ? `Surah ${surah.nameSimple} (${surah.meaning}) — ${surah.versesCount} Ayahs — SurahSpot`
      : `Surah ${surah.nameSimple} — ${surah.versesCount} Ayahs — SurahSpot`,
    description: describe(surah),

    openGraph: {
      type: "article",
      title: hasDistinctMeaning(surah)
        ? `Surah ${surah.nameSimple} — ${surah.meaning}`
        : `Surah ${surah.nameSimple}`,
      description: describe(surah),
      url: surahPath(surah),
    },
  };
}

function QuickAnswer({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="surah-answer">
      <h3>{question}</h3>
      <p>{answer}</p>
    </div>
  );
}

export default async function SurahPage({ params }: PageProps) {
  const { slug } = await params;
  const surah = findSurahBySlug(slug);
  if (!surah) notFound();

  const { previous, next } = surahNeighbours(surah.id);
  const ayahWord = surah.versesCount === 1 ? "Ayah" : "Ayahs";
  const juzSpan = formatJuzSpan(surah.juz);
  const readerPath = surahReaderPath(surah);

  /*
   * Breadcrumbs only. There is no schema.org type that honestly describes a
   * chapter of the Qur'an, and picking an approximate one to win a rich result
   * is the kind of thing that gets structured data ignored site-wide.
   */
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Surahs", item: `${siteOrigin()}/surahs` },
      {
        "@type": "ListItem",
        position: 2,
        name: `Surah ${surah.nameSimple}`,
        item: `${siteOrigin()}${surahPath(surah)}`,
      },
    ],
  };

  return (
    <SitePage>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />

      <section className="content-section surah-page" aria-labelledby="surah-title">
        <header className="surah-page-head">
          <nav className="surah-breadcrumb" aria-label="Breadcrumb">
            <Link href="/surahs">Surahs</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{surah.nameSimple}</span>
          </nav>

          <p className="eyebrow">
            SURAH {surah.id} OF {TOTAL_SURAHS}
          </p>

          <h1 id="surah-title">
            {surah.nameSimple}
            {hasDistinctMeaning(surah) ? (
              <>
                <br />
                <em>{surah.meaning}</em>
              </>
            ) : null}
          </h1>

          <p className="surah-page-arabic" lang="ar" dir="rtl">
            {surah.nameArabic}
          </p>

          <p className="surah-page-lede">{describe(surah)}</p>

          {surah.summary ? <p className="surah-page-summary">{surah.summary}</p> : null}
        </header>

        <dl className="surah-facts" aria-label={`Facts about Surah ${surah.nameSimple}`}>
          <div>
            <dt>Ayahs</dt>
            <dd>{surah.versesCount}</dd>
          </div>
          <div>
            <dt>Revealed in</dt>
            <dd>{surah.revelationPlace}</dd>
          </div>
          <div>
            <dt>Juz</dt>
            <dd>{juzSpan.replace(/^Juz /, "")}</dd>
          </div>
          <div>
            <dt>Order in the Qur&rsquo;an</dt>
            <dd>
              {surah.id} of {TOTAL_SURAHS}
            </dd>
          </div>
          <div>
            <dt>By length</dt>
            <dd>{ordinal(surah.lengthRank)} longest</dd>
          </div>
        </dl>

        {/*
          Two destinations, not two labels for one. The reader is the
          Surah-specific tool; the game modes build their rounds from all 114, so
          that button is labelled as the general practice it actually is rather
          than implying a per-Surah round this app does not build.
        */}
        <div className="surah-page-actions">
          <Link className="surah-page-action is-primary" href={readerPath}>
            Read Surah {surah.nameSimple}
          </Link>
          <Link className="surah-page-action" href="/?challenge=1&mode=ayah-counts">
            Practise Ayah counts
          </Link>
        </div>

        <section className="surah-answers" aria-labelledby="surah-answers-title">
          <h2 id="surah-answers-title">Quick answers</h2>

          <QuickAnswer
            question={`How many Ayahs are in Surah ${surah.nameSimple}?`}
            answer={`Surah ${surah.nameSimple} has ${surah.versesCount} ${ayahWord}. It is the ${ordinal(
              surah.lengthRank,
            )} longest Surah of the ${TOTAL_SURAHS}.`}
          />

          <QuickAnswer
            question={`Where was Surah ${surah.nameSimple} revealed?`}
            answer={`In ${surah.revelationPlace}, which makes it ${
              surah.revelationPlace === "Makkah" ? "a Makki" : "a Madani"
            } Surah.`}
          />

          <QuickAnswer
            question={`Which Juz is Surah ${surah.nameSimple} in?`}
            answer={
              surah.juz.length === 1
                ? `It sits entirely within ${juzSpan}.`
                : `It spans ${juzSpan}.`
            }
          />

          {/*
            Dropped rather than reworded for the six Surahs named after a person
            or a letter: "Hud is usually rendered in English as Hud" answers
            nothing, and a question with a non-answer under it is worse than no
            question.
          */}
          {hasDistinctMeaning(surah) ? (
            <QuickAnswer
              question={`What does ${surah.nameSimple} mean?`}
              answer={`${surah.nameSimple} (${surah.nameArabic}) is usually rendered in English as “${surah.meaning}”.`}
            />
          ) : null}
        </section>

        <section className="surah-practice" aria-labelledby="surah-practice-title">
          <h2 id="surah-practice-title">Practising this Surah on SurahSpot</h2>

          <p>
            Opening Surah {surah.nameSimple} in Learning Blocks gives you the full Arabic
            with a translation beside it, and remembers where you stopped. From there you
            can hide individual Ayahs and rebuild them from memory, or hide the whole Surah
            and work through it in sequence &mdash; which is the part a plain reader
            cannot do.
          </p>

          <p>
            The game modes draw their rounds from across all {TOTAL_SURAHS} Surahs rather
            than one, so they are practice for recognition in general: naming a Surah from
            a recited Ayah, estimating Ayah counts, and choosing the Ayah that comes next.
            The <Link href="/how-it-works">how it works</Link> page explains the scoring.
          </p>
        </section>

        <nav className="surah-page-nav" aria-label="Nearby Surahs">
          {previous ? (
            <Link className="surah-page-nav-link is-previous" href={surahPath(previous)}>
              <span>Previous</span>
              <strong>
                {previous.id}. {previous.nameSimple}
              </strong>
            </Link>
          ) : (
            <span />
          )}

          {next ? (
            <Link className="surah-page-nav-link is-next" href={surahPath(next)}>
              <span>Next</span>
              <strong>
                {next.id}. {next.nameSimple}
              </strong>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </section>
    </SitePage>
  );
}
