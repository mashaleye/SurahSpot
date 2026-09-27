import { ImageResponse } from "next/og";
import { ShareBrandLockup } from "@/components/share/ShareBrandLockup";
import { openShareResult } from "@/lib/share/result-token";
import { sharePresentation } from "@/lib/share/result-copy";

export const RESULT_CARD_SIZE = { width: 1200, height: 630 } as const;

const BRAND_TYPE = 'Arial, "Helvetica Neue", sans-serif';

const stateColor = {
  perfect: "#59c997",
  close: "#d2a853",
  missed: "#4f5752",
  skipped: "#d9dfdb",
} as const;

/** Shared renderer for the public result OG image and custom share sheet. */
export function renderResultCardImage(token: string) {
  const result = openShareResult(token);
  const presentation = sharePresentation(result);

  return new ImageResponse(
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      padding: "58px 64px",
      background: "#0d1511",
      color: "#f6f3ea",
      fontFamily: BRAND_TYPE,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <ShareBrandLockup width={194} markColor="#59c997" wordColor="#f6f3ea" />
        <div style={{ display: "flex", color: "#8b9a92", fontSize: 18, fontWeight: 800, letterSpacing: "0.18em" }}>RESULT</div>
      </div>

      <div style={{ display: "flex", marginTop: 48, color: "#67d5a5", fontSize: 18, fontWeight: 900, letterSpacing: "0.16em" }}>
        {presentation.kicker}
      </div>

      <div style={{ display: "flex", marginTop: 18, maxWidth: 900, fontSize: 67, lineHeight: 0.98, letterSpacing: "-0.055em", fontWeight: 900 }}>
        {presentation.headline}
      </div>

      <div style={{ display: "flex", gap: 58, marginTop: "auto", alignItems: "flex-end" }}>
        {[
          [presentation.primaryValue, presentation.primaryLabel],
          [presentation.secondaryValue, presentation.secondaryLabel],
          [presentation.tertiaryValue, presentation.tertiaryLabel],
        ].map(([value, label]) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", fontSize: 43, fontWeight: 900, letterSpacing: "-0.045em" }}>{value}</div>
            <div style={{ display: "flex", color: "#84928a", fontSize: 14, fontWeight: 900, letterSpacing: "0.15em" }}>{label}</div>
          </div>
        ))}

        <div style={{ display: "flex", gap: 9, marginLeft: "auto", paddingBottom: 8 }}>
          {result.roundStates.map((state, index) => (
            <div key={`${state}-${index}`} style={{ width: 28, height: 28, borderRadius: 7, background: stateColor[state] }} />
          ))}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 34, paddingTop: 22, borderTop: "1px solid #25322b", color: "#b8c2bc", fontSize: 18, fontWeight: 700 }}>
        <span>{presentation.challenge}</span>
        <span style={{ color: "#67d5a5", fontWeight: 900, letterSpacing: "-0.02em" }}>surahspot.com</span>
      </div>
    </div>,
    RESULT_CARD_SIZE,
  );
}
