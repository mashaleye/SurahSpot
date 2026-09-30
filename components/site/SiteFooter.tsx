import Link from "next/link";
import { BrandLockup } from "@/components/BrandLockup";
import { FeedbackForm } from "./FeedbackForm";

const INTERNAL_LINKS = [
  ["How it works", "/how-it-works"],
  ["Learning Blocks", "/learning-blocks"],
  ["99 Names of Allah", "/names-of-allah"],
  ["Dhikr & Duas", "/dhikr-duas"],
  ["Popular Surahs", "/surahs"],
  ["Sitemap", "/sitemap"],
  ["Privacy", "/privacy"],
  ["Terms", "/terms"],
] as const;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <div className="footer-intro">
          <Link className="footer-lockup" href="/" aria-label="SurahSpot home">
            <BrandLockup />
          </Link>
          <h2>Recall. Estimate. Learn.</h2>
          <p>
            Practice a little at a time&mdash;listen, recall, and build stronger
            familiarity with the Surahs you know.
          </p>
          <p className="footer-source-note">
            Use it alongside your regular Qur&rsquo;an study and trusted teachers or resources.
          </p>
        </div>

        <div className="footer-link-columns">
          <section>
            <h3>Explore</h3>
            {INTERNAL_LINKS.map(([label, href]) => (
              <Link href={href} key={href}>{label}</Link>
            ))}
          </section>
          <section>
            <h3>Trusted resources</h3>
            <a href="https://quran.com/" target="_blank" rel="noreferrer">Quran.com ↗</a>
            <a href="https://sunnah.com/" target="_blank" rel="noreferrer">Sunnah.com ↗</a>
          </section>
        </div>

        <FeedbackForm />
      </div>

      <div className="site-footer-bottom">
        <span>© {new Date().getFullYear()} SurahSpot</span>
        <span>Made for thoughtful Qur&rsquo;an recall and practice.</span>
      </div>
    </footer>
  );
}
