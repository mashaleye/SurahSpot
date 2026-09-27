import type { ReactNode } from "react";

/**
 * Official brand marks for the share targets.
 *
 * Taken from each company's own brand asset pack, not redrawn. The geometry is
 * exactly as supplied; the only changes made are mechanical:
 *
 *   - Each mark is cropped to its own ink bounds and re-padded to a common
 *     box, because the packs disagree about clear space. Facebook's ships with
 *     roughly 14% padding built in and the other three with none, so dropped
 *     into equal boxes untouched, Facebook renders about a third smaller than
 *     its neighbours.
 *   - X is set slightly smaller than the rest. It is a bare letterform with no
 *     enclosing shape, and at matched geometric size it reads noticeably
 *     larger than the three enclosed glyphs beside it.
 *   - Fills are `currentColor` so each mark follows the button, which inverts
 *     between light and dark mode. Every one of these brands supplies both a
 *     black and a white monochrome variant for exactly this purpose, so the
 *     rendered result is always one of the two treatments they publish.
 *
 * What must not happen here: recolouring these to arbitrary colours, stretching
 * them, or altering the paths. If a mark needs to sit on a coloured surface,
 * change the surface.
 */

export type BrandMarkName = "facebook" | "x" | "whatsapp" | "instagram";

type BrandMark = { viewBox: string; paths: ReactNode };

const MARKS: Record<BrandMarkName, BrandMark> = {
  facebook: {
    // Facebook Brand Asset Pack — Secondary Logo (the f in its circle).
    viewBox: "100.00 99.08 500.00 500.00",
    paths: (
      <>
      <path
        d="M 600 350 C 600 211.929688 488.070312 100 350 100 C 211.929688 100 100 211.929688 100 350 C 100 467.246094 180.714844 565.621094 289.605469 592.636719 L 289.605469 426.394531 L 238.054688 426.394531 L 238.054688 350 L 289.605469 350 L 289.605469 317.082031 C 289.605469 231.988281 328.113281 192.550781 411.652344 192.550781 C 427.492188 192.550781 454.820312 195.652344 466 198.761719 L 466 268.015625 C 460.101562 267.394531 449.851562 267.082031 437.117188 267.082031 C 396.125 267.082031 380.285156 282.609375 380.285156 322.980469 L 380.285156 350 L 461.945312 350 L 447.917969 426.394531 L 380.285156 426.394531 L 380.285156 598.167969 C 504.074219 583.21875 600 477.816406 600 350 "
        fill="currentColor"
      />
      </>
    ),
  },
  x: {
    // x.com brand toolkit — the X mark.
    viewBox: "-186.13 -172.95 1572.27 1572.27",
    paths: (
      <>
      <path
        d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z"
        fill="currentColor"
      />
      </>
    ),
  },
  whatsapp: {
    // WhatsApp Brand Resource Center — Digital Glyph.
    viewBox: "0.00 0.00 720.00 720.00",
    paths: (
      <>
      <path
        d="M360,0C161.18,0,0,161.18,0,360c0,65.41,17.45,126.75,47.94,179.61L0,720l187.02-44.21c51.34,28.18,110.28,44.21,172.98,44.21,198.82,0,360-161.18,360-360S558.82,0,360,0ZM360,655.52c-60.17,0-116.13-17.98-162.82-48.87l-110.49,28.14,30.99-105.61c-33.53-47.93-53.2-106.26-53.2-169.19,0-163.21,132.31-295.52,295.52-295.52s295.52,132.31,295.52,295.52-132.31,295.52-295.52,295.52Z"
        fill="currentColor"
      />
      <path
        d="M444.35,407.52l87.1,41.06c4,1.88,6.56,5.94,6.2,10.34-.94,11.46-5.54,34.43-26.13,55.02-58.12,58.12-162.49-7.64-166.74-10.18-25.67-13.79-50.06-32.24-73.19-55.36s-41.58-47.52-55.37-73.19c-2.55-4.24-68.31-108.61-10.18-166.74,20.59-20.59,43.56-25.19,55.02-26.13,4.41-.36,8.46,2.2,10.34,6.2l41.07,87.1c1.94,4.12,1.09,9.02-2.13,12.24l-30.61,30.61c-6.62,6.62-8.56,16.93-4,25.11,11.17,20.03,26.19,39.32,43.59,57.07,17.75,17.4,37.04,32.43,57.07,43.59,8.18,4.56,18.48,2.62,25.11-4l30.61-30.61c3.22-3.22,8.12-4.08,12.24-2.13Z"
        fill="currentColor"
      />
      </>
    ),
  },
  instagram: {
    // Instagram Brand Asset Pack 2023 — Static Glyph.
    viewBox: "-29.42 -29.41 1063.83 1063.83",
    paths: (
      <>
      <path
        d="M295.42,6c-53.2,2.51-89.53,11-121.29,23.48-32.87,12.81-60.73,30-88.45,57.82S40.89,143,28.17,175.92c-12.31,31.83-20.65,68.19-23,121.42S2.3,367.68,2.56,503.46,3.42,656.26,6,709.6c2.54,53.19,11,89.51,23.48,121.28,12.83,32.87,30,60.72,57.83,88.45S143,964.09,176,976.83c31.8,12.29,68.17,20.67,121.39,23s70.35,2.87,206.09,2.61,152.83-.86,206.16-3.39S799.1,988,830.88,975.58c32.87-12.86,60.74-30,88.45-57.84S964.1,862,976.81,829.06c12.32-31.8,20.69-68.17,23-121.35,2.33-53.37,2.88-70.41,2.62-206.17s-.87-152.78-3.4-206.1-11-89.53-23.47-121.32c-12.85-32.87-30-60.7-57.82-88.45S862,40.87,829.07,28.19c-31.82-12.31-68.17-20.7-121.39-23S637.33,2.3,501.54,2.56,348.75,3.4,295.42,6m5.84,903.88c-48.75-2.12-75.22-10.22-92.86-17-23.36-9-40-19.88-57.58-37.29s-28.38-34.11-37.5-57.42c-6.85-17.64-15.1-44.08-17.38-92.83-2.48-52.69-3-68.51-3.29-202s.22-149.29,2.53-202c2.08-48.71,10.23-75.21,17-92.84,9-23.39,19.84-40,37.29-57.57s34.1-28.39,57.43-37.51c17.62-6.88,44.06-15.06,92.79-17.38,52.73-2.5,68.53-3,202-3.29s149.31.21,202.06,2.53c48.71,2.12,75.22,10.19,92.83,17,23.37,9,40,19.81,57.57,37.29s28.4,34.07,37.52,57.45c6.89,17.57,15.07,44,17.37,92.76,2.51,52.73,3.08,68.54,3.32,202s-.23,149.31-2.54,202c-2.13,48.75-10.21,75.23-17,92.89-9,23.35-19.85,40-37.31,57.56s-34.09,28.38-57.43,37.5c-17.6,6.87-44.07,15.07-92.76,17.39-52.73,2.48-68.53,3-202.05,3.29s-149.27-.25-202-2.53m407.6-674.61a60,60,0,1,0,59.88-60.1,60,60,0,0,0-59.88,60.1M245.77,503c.28,141.8,115.44,256.49,257.21,256.22S759.52,643.8,759.25,502,643.79,245.48,502,245.76,245.5,361.22,245.77,503m90.06-.18a166.67,166.67,0,1,1,167,166.34,166.65,166.65,0,0,1-167-166.34"
        fill="currentColor"
      />
      </>
    ),
  },
};

export function BrandMark({ name }: { name: BrandMarkName }) {
  const mark = MARKS[name];
  return (
    <svg
      viewBox={mark.viewBox}
      className="share-brand-mark"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      {mark.paths}
    </svg>
  );
}
