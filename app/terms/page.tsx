import type { Metadata } from "next";
import Link from "next/link";

import { SitePage } from "@/components/site/SitePage";

export const metadata: Metadata = {
  alternates: { canonical: "/terms" },
  title: "Terms — SurahSpot",
  description: "The terms for using SurahSpot, and where its Qur'an content comes from.",
};

export default function TermsPage() {
  return (
    <SitePage>
      <section className="content-section legal-page" aria-labelledby="terms-title">
        <header className="legal-head">
          <p className="eyebrow">TERMS</p>
          <h1 id="terms-title">
            Using SurahSpot,
            <br />
            <em>and what it is not.</em>
          </h1>
          <p className="legal-lede">
            SurahSpot is free, needs no account, and is a practice aid &mdash; not a
            replacement for study with a qualified teacher.
          </p>
        </header>

        <div className="legal-body">
          <h2>What this is</h2>
          <p>
            A tool for practising Surah recognition, Ayah-count estimation and Qur&rsquo;an
            recall, and for reading the Qur&rsquo;an page by page. Use it alongside your
            regular study and trusted teachers, not instead of them. Scores and streaks measure
            practice on this site; they are not a measure of understanding.
          </p>

          <h2>Where the content comes from</h2>
          <p>
            The Qur&rsquo;an text, translations, and recitations are served by{" "}
            <a href="https://quran.foundation/" target="_blank" rel="noreferrer">
              Quran Foundation
            </a>
            , and each translation is credited to its translator where it appears. The Arabic
            is set in the KFGQPC Uthmanic Hafs face, published by the King Fahd Glorious
            Qur&rsquo;an Printing Complex for Qur&rsquo;anic use.
          </p>
          <p>
            That content belongs to its respective holders and is presented here under their
            terms. It is not SurahSpot&rsquo;s to relicense. If you believe something is
            presented incorrectly, please say so through the feedback form &mdash; accuracy in
            Qur&rsquo;anic text matters more than anything else on this site, and a correction
            will be treated as urgent.
          </p>

          <h2>Fair use of the site</h2>
          <p>
            Play, read, and share freely. Please do not attempt to script or scrape the site,
            work around the rate limits, or use it in a way that degrades it for others. The
            Qur&rsquo;an content is fetched from an upstream service with finite capacity, and
            abuse takes the site down for everyone.
          </p>

          <h2>Availability</h2>
          <p>
            SurahSpot is offered as it is, with no guarantee of uptime. It depends on an
            upstream content service, and when that is unavailable parts of the site will be
            too. Nothing is stored on your behalf that you would lose in an outage; your
            reading progress lives on your own device.
          </p>

          <h2>Sharing</h2>
          <p>
            Share links for results and Ayahs are unlisted and carry no personal information.
            Anyone with the link can open one.
          </p>

          <h2>Changes</h2>
          <p>
            These terms may change as the site does. Continuing to use SurahSpot after a change
            means the current version applies.
          </p>

          <p className="legal-contact">
            See also the <Link href="/privacy">privacy page</Link>. Anything else, use the
            feedback form at the bottom of any page.
          </p>
        </div>
      </section>
    </SitePage>
  );
}
