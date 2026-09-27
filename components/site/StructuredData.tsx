import { siteOrigin } from "@/lib/config/site";

/**
 * Schema.org structured data.
 *
 * This is what lets a search engine understand what SurahSpot *is* rather
 * than inferring it from prose — which is the difference between appearing as
 * a generic page and appearing as a named application with a description and
 * a search entry point.
 *
 * Everything asserted here is verifiable on the page itself. Structured data
 * that overstates — invented ratings, fake review counts, a price on
 * something that is free — is the fastest way to earn a manual penalty, and
 * there is nothing here worth risking that for.
 *
 * Rendered as a plain script tag rather than through next/script because it
 * has to be in the HTML a crawler receives, not injected after hydration.
 */
export function StructuredData() {
  const origin = siteOrigin();

  const graph = [
    {
      "@type": "WebSite",
      "@id": `${origin}/#website`,
      url: `${origin}/`,
      name: "SurahSpot",
      description:
        "Practice Surah recognition, Ayah-count estimation and Qur'an recall in short seven-round sessions, and read the Qur'an page by page with hidden-Ayah practice.",
      inLanguage: "en",
      publisher: { "@id": `${origin}/#organization` },
    },
    {
      /*
       * The app itself. WebApplication rather than Game: the guessing modes
       * are a game, but Learning Blocks is a reading tool, and the site as a
       * whole is closer to study software than to entertainment.
       */
      "@type": "WebApplication",
      "@id": `${origin}/#app`,
      url: `${origin}/`,
      name: "SurahSpot",
      applicationCategory: "EducationalApplication",
      operatingSystem: "Any browser. Installable on iOS and Android.",
      browserRequirements: "Requires JavaScript.",
      description:
        "Listen to an Ayah, follow the recitation, and identify the Surah it comes from. Read the Qur'an page by page, hide Ayahs for recall practice, and rebuild them in sequence.",
      inLanguage: "en",
      isAccessibleForFree: true,
      offers: {
        // Stated because it is true and because "free" is a thing people
        // filter on. No price on anything that is not actually sold.
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      featureList: [
        "Surah recognition from recitation",
        "Ayah-count estimation",
        "Ayah completion and sequencing",
        "Page-by-page Qur'an reading",
        "Hidden-Ayah recall practice",
        "Memorization tracking",
      ],
    },
    {
      "@type": "Organization",
      "@id": `${origin}/#organization`,
      name: "SurahSpot",
      url: `${origin}/`,
      logo: `${origin}/icon-512.png`,
    },
  ];

  return (
    <script
      type="application/ld+json"
      // The content is built here from fixed strings, not from anything a
      // visitor can influence, so there is nothing to escape.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({ "@context": "https://schema.org", "@graph": graph }),
      }}
    />
  );
}
