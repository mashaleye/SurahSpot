"use client";

import { useState } from "react";

/**
 * SurahSpot brand lockup, inlined.
 *
 * The artwork is inline rather than an <img> because CSS cannot reach inside an
 * SVG loaded through <img>, and the intro animation drives the mark and the
 * wordmark to different fills independently.
 *
 * Geometry matches public/brand/surahspot-lockup.svg exactly — same viewBox and
 * the same two transforms — so that file can double as the mask that clips the
 * shimmer sweep to the glyph shapes.
 *
 * All colour and motion live in CSS. The single piece of state here exists
 * because the intro sets animation-fill-mode: both, which pins `fill` and would
 * outrank any hover rule. Adding .brand-intro-done once the intro ends releases
 * it. If JS never runs the class never lands, fill-mode holds the correct
 * resting colours, and only hover is lost — so there is no hydration flash and
 * no broken state.
 */

import { MARK_PATH, WORD_PATH } from "./brand-art";

export function BrandLockup({ label }: { label?: string }) {
  const [introDone, setIntroDone] = useState(false);

  // With a label the SVG is exposed as an image; without one it is decorative,
  // which is correct when the wrapping link already names itself.
  const labelling = label
    ? { role: "img" as const, "aria-label": label }
    : { "aria-hidden": true as const, focusable: false as const };

  return (
    <span
      className={introDone ? "brand-lockup brand-intro-done" : "brand-lockup"}
      onAnimationEnd={(event) => {
        // brand-glow is the longest of the four; ignore the others as they end.
        if (event.animationName === "brand-glow") setIntroDone(true);
      }}
    >
      <svg className="brand-lockup-art" viewBox="0 0 358.21 107.65" {...labelling}>
        <g transform="translate(-0.96 -1.20)">
          <path
            className="brand-mark"
            d={MARK_PATH}
            fillRule="evenodd"
            clipRule="evenodd"
            transform="scale(0.09023790)"
          />
          <path
            className="brand-word"
            d={WORD_PATH}
            fillRule="evenodd"
            clipRule="evenodd"
            transform="translate(124.12 36.00) scale(0.11134021)"
          />
        </g>
      </svg>
      <span className="brand-lockup-sweep" aria-hidden="true" />
    </span>
  );
}