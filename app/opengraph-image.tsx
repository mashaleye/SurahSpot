import { ImageResponse } from "next/og";
import { ShareBrandLockup } from "@/components/share/ShareBrandLockup";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BRAND_TYPE = 'Arial, "Helvetica Neue", sans-serif';

export default function Image() {
  return new ImageResponse(
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      padding: "64px",
      background: "#f4f0e7",
      color: "#102019",
      fontFamily: BRAND_TYPE,
    }}>
      <ShareBrandLockup width={200} markColor="#17845f" wordColor="#102019" />
      <div style={{ marginTop: 70, maxWidth: 880, fontSize: 78, lineHeight: 0.98, letterSpacing: "-0.06em", fontWeight: 900 }}>
        Can you recognize the Surah?
      </div>
      <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ maxWidth: 620, color: "#69756f", fontSize: 24, fontWeight: 650, lineHeight: 1.35 }}>
          Short rounds for listening, recall, and building familiarity over time.
        </div>
        <div style={{ color: "#17845f", fontSize: 20, fontWeight: 900, letterSpacing: "0.08em" }}>SURAHSPOT.COM</div>
      </div>
    </div>,
    size,
  );
}
