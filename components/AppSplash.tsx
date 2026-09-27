import {
  BRAND_GROUP_TRANSFORM,
  BRAND_VIEWBOX,
  MARK_PATH,
  MARK_TRANSFORM,
  WORD_PATH,
  WORD_TRANSFORM,
} from "./brand-art";

/**
 * Launch splash for the installed (home-screen) app.
 *
 * A server component with no interactivity, so the markup is in the HTML the
 * browser receives and paints on first parse — before React hydrates, and
 * before the first round request resolves. A client component would only
 * appear after hydration, which is precisely the gap the splash exists to fill.
 *
 * Visibility and dismissal are handled by the inline script in layout.tsx, in
 * plain DOM. That keeps the splash working even when the JS bundle is slow to
 * arrive, which is exactly when a launch screen matters.
 *
 * It reuses .brand-lockup and its child classes, so the colour swap, glow and
 * sweep are the same keyframes the header lockup runs. The splash only
 * overrides scale and makes the shimmer loop.
 */
export function AppSplash() {
  return (
    <div id="app-splash" className="app-splash" role="status" aria-label="SurahSpot is starting">
      <span className="brand-lockup">
        <svg className="brand-lockup-art" viewBox={BRAND_VIEWBOX} aria-hidden focusable={false}>
          <g transform={BRAND_GROUP_TRANSFORM}>
            <path
              className="brand-mark"
              d={MARK_PATH}
              fillRule="evenodd"
              clipRule="evenodd"
              transform={MARK_TRANSFORM}
            />
            <path
              className="brand-word"
              d={WORD_PATH}
              fillRule="evenodd"
              clipRule="evenodd"
              transform={WORD_TRANSFORM}
            />
          </g>
        </svg>
        <span className="brand-lockup-sweep" aria-hidden="true" />
      </span>
    </div>
  );
}