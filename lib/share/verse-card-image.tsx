import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { ShareBrandLockup } from "@/components/share/ShareBrandLockup";
import { openShareVerse } from "@/lib/share/verse-token";
import { loadSharedVerse } from "@/lib/share/verse-data";
import { buildArabicSatoriLines } from "@/lib/share/rtl-card-text";

export const VERSE_CARD_SIZE = { width: 1200, height: 630 } as const;

const BRAND_TYPE = 'Arial, "Helvetica Neue", sans-serif';
const QURAN_FONT_FILE = "UthmanicHafs1Ver18.ttf";

async function loadQuranFont() {
  try {
    const data = await readFile(join(process.cwd(), "public", "fonts", QURAN_FONT_FILE));
    return Uint8Array.from(data).buffer;
  } catch {
    // Local/mobile development may run before the optional Quran font has
    // been fetched. The card must still render instead of returning a 500.
    return null;
  }
}

function excerpt(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max).replace(/\s+\S*$/, "").trim();
  return `${cut}…`;
}

/**
 * Render the verse card from a normal module so both the metadata image route
 * and the in-app share-sheet API endpoint use exactly the same implementation.
 * Keeping this outside `opengraph-image.tsx` avoids importing a Next metadata
 * special file from a Route Handler, which is unreliable across dev/runtime
 * targets and was the source of broken share-sheet previews.
 */
export async function renderVerseCardImage(token: string) {
  const verse = await loadSharedVerse(openShareVerse(token));
  const quranFont = await loadQuranFont();
  const arabicLines = quranFont ? buildArabicSatoriLines(verse.arabic) : [];

  const image = (
    <div style={{
      width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "58px 64px",
      background: "#f5f1e7", color: "#102019", fontFamily: BRAND_TYPE,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <ShareBrandLockup width={194} markColor="#17845f" wordColor="#102019" />
        <div style={{ display: "flex", color: "#77827c", fontSize: 17, fontWeight: 900, letterSpacing: "0.16em" }}>
          {`AYAH · ${verse.chapterId}:${verse.verseNumber}`}
        </div>
      </div>

      {quranFont ? (
        <div
          dir="rtl"
          lang="ar"
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            marginTop: 48,
            gap: 2,
            fontFamily: "UthmanicHafs",
            fontSize: 48,
            fontWeight: 400,
            lineHeight: 1.55,
            color: "#116e51",
          }}
        >
          {arabicLines.map((line, index) => (
            <div
              key={`${verse.chapterId}:${verse.verseNumber}:${index}`}
              dir="rtl"
              lang="ar"
              style={{
                width: "100%",
                display: "flex",
                justifyContent: "center",
                textAlign: "center",
                whiteSpace: "nowrap",
              }}
            >
              {line}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "center", textAlign: "center", marginTop: 72, color: "#116e51", fontSize: 28, fontWeight: 900, letterSpacing: "0.08em" }}>
          {verse.nameSimple} · {verse.chapterId}:{verse.verseNumber}
        </div>
      )}

      <div style={{ height: 1, background: "#d8d4c9", marginTop: quranFont ? 32 : 48 }} />

      <div style={{ display: "flex", marginTop: 28, maxWidth: 1000, fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 28, lineHeight: 1.42, fontStyle: "italic", fontWeight: 500, letterSpacing: "-0.015em", color: "#26362e" }}>
        {`“${excerpt(verse.translation, 230)}”`}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", fontSize: 20, fontWeight: 900, letterSpacing: "-0.025em" }}>
            {`${verse.nameSimple} · ${verse.chapterId}:${verse.verseNumber}`}
          </div>
          <div style={{ color: "#77827c", fontSize: 15, fontWeight: 600 }}>{verse.translationAuthor || verse.translationName}</div>
        </div>
        <div style={{ color: "#137c59", fontSize: 18, fontWeight: 900, letterSpacing: "-0.02em" }}>surahspot.com</div>
      </div>
    </div>
  );

  if (!quranFont) {
    return new ImageResponse(image, VERSE_CARD_SIZE);
  }

  return new ImageResponse(image, {
    ...VERSE_CARD_SIZE,
    fonts: [
      {
        name: "UthmanicHafs",
        data: quranFont,
        weight: 400,
        style: "normal",
      },
    ],
  });
}
