import type { CSSProperties } from "react";
import {
  BRAND_GROUP_TRANSFORM,
  BRAND_VIEWBOX,
  MARK_PATH,
  MARK_TRANSFORM,
  WORD_PATH,
  WORD_TRANSFORM,
} from "@/components/brand-art";

type Props = {
  className?: string;
  label?: string;
  width?: number;
  markColor?: string;
  wordColor?: string;
  style?: CSSProperties;
};

/**
 * Static SurahSpot lockup for public share pages and ImageResponse cards.
 *
 * It uses the exact same vector paths as the animated site lockup but contains
 * no client state or animation, which keeps social-card rendering deterministic.
 */
export function ShareBrandLockup({
  className,
  label = "SurahSpot",
  width,
  markColor = "var(--green)",
  wordColor = "var(--ink)",
  style,
}: Props) {
  const height = width ? (width * 107.65) / 358.21 : undefined;

  return (
    <svg
      className={className}
      viewBox={BRAND_VIEWBOX}
      width={width}
      height={height}
      style={style}
      role="img"
      aria-label={label}
    >
      <g transform={BRAND_GROUP_TRANSFORM}>
        <path
          d={MARK_PATH}
          fill={markColor}
          fillRule="evenodd"
          clipRule="evenodd"
          transform={MARK_TRANSFORM}
        />
        <path
          d={WORD_PATH}
          fill={wordColor}
          fillRule="evenodd"
          clipRule="evenodd"
          transform={WORD_TRANSFORM}
        />
      </g>
    </svg>
  );
}
