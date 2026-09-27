import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShareBrandLockup } from "@/components/share/ShareBrandLockup";
import { openShareVerse } from "@/lib/share/verse-token";
import { loadSharedVerse } from "@/lib/share/verse-data";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  try {
    const { token } = await params;
    const verse = await loadSharedVerse(openShareVerse(token));
    const description = verse.translation.length > 180 ? `${verse.translation.slice(0, 177).trim()}…` : verse.translation;
    return {
      title: `${verse.nameSimple} ${verse.chapterId}:${verse.verseNumber} · SurahSpot`,
      description,
      robots: { index: false, follow: true },
      openGraph: { title: `${verse.nameSimple} ${verse.chapterId}:${verse.verseNumber} · SurahSpot`, description, type: "article" },
      twitter: { card: "summary_large_image", title: `${verse.nameSimple} ${verse.chapterId}:${verse.verseNumber} · SurahSpot`, description },
    };
  } catch {
    return { title: "Shared Ayah · SurahSpot" };
  }
}

export default async function SharedVersePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let verse;
  try {
    verse = await loadSharedVerse(openShareVerse(token));
  } catch {
    notFound();
  }

  return (
    <main className="verse-share-page-shell">
      <article className="verse-share-page-card share-brand-type">
        <header className="share-page-brand">
          <Link href="/" className="share-page-logo" aria-label="SurahSpot home">
            <ShareBrandLockup className="share-page-logo-art" />
          </Link>
          <span>AYAH</span>
        </header>

        <div className="verse-share-reference">
          <span>Surah {verse.chapterId}</span>
          <b>{verse.nameSimple}</b>
          <i dir="rtl" lang="ar">{verse.nameArabic}</i>
        </div>

        <p className="verse-share-arabic" dir="rtl" lang="ar" translate="no">{verse.arabic}</p>
        <div className="verse-share-divider" />
        <blockquote translate="no">“{verse.translation}”</blockquote>
        <div className="verse-share-attribution">
          <b>{verse.nameSimple} · {verse.chapterId}:{verse.verseNumber}</b>
          <span>{verse.translationAuthor || verse.translationName}</span>
        </div>

        <Link className="primary share-page-cta" href="/">Try a practice round <span aria-hidden="true">→</span></Link>
      </article>
    </main>
  );
}
