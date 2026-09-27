import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShareBrandLockup } from "@/components/share/ShareBrandLockup";
import { openShareResult } from "@/lib/share/result-token";
import { roundStateEmoji, sharePresentation } from "@/lib/share/result-copy";

function challengeHref(mode: string, variant?: string) {
  const params = new URLSearchParams({ challenge: "1", mode });
  if (variant) params.set("variant", variant);
  return `/?${params.toString()}`;
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  try {
    const { token } = await params;
    const result = openShareResult(token);
    const presentation = sharePresentation(result);
    const description = `${presentation.primaryValue} ${presentation.primaryLabel.toLowerCase()} · ${result.score} points. Try a fresh seven-round run in the same mode.`;
    return {
      title: `SurahSpot — ${presentation.headline}`,
      description,
      robots: { index: false, follow: true },
      openGraph: {
        title: `SurahSpot — ${presentation.headline}`,
        description,
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: `SurahSpot — ${presentation.headline}`,
        description,
      },
    };
  } catch {
    return { title: "Shared game result · SurahSpot" };
  }
}

export default async function SharedResultPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let result;
  try {
    result = openShareResult(token);
  } catch {
    notFound();
  }

  const presentation = sharePresentation(result);

  return (
    <main className="share-page-shell">
      <section className="share-page-card share-brand-type">
        <header className="share-page-brand">
          <Link href="/" className="share-page-logo" aria-label="SurahSpot home">
            <ShareBrandLockup className="share-page-logo-art" />
          </Link>
          <span>RESULT</span>
        </header>

        <p className="share-page-kicker">{presentation.kicker}</p>
        <h1>{presentation.headline}</h1>

        <div className="share-page-stats">
          <div><b>{presentation.primaryValue}</b><span>{presentation.primaryLabel}</span></div>
          <div><b>{presentation.secondaryValue}</b><span>{presentation.secondaryLabel}</span></div>
          <div><b>{presentation.tertiaryValue}</b><span>{presentation.tertiaryLabel}</span></div>
        </div>

        <div className="share-page-rounds" aria-label="Round results">
          {result.roundStates.map((state, index) => (
            <span key={`${state}-${index}`} title={`Round ${index + 1}: ${state}`}>{roundStateEmoji(state)}</span>
          ))}
        </div>

        <div className="share-page-challenge">
          <p>{presentation.challenge}</p>
          <Link className="primary share-page-cta" href={challengeHref(result.mode, result.variant)}>
            Take the challenge
            <span aria-hidden="true">→</span>
          </Link>
          <small>Same mode, fresh rounds, and nothing from this result is spoiled.</small>
        </div>
      </section>
    </main>
  );
}
