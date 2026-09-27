"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

export function SurahsHero() {
  const sectionRef =
    useRef<HTMLElement>(null);

  const mediaRef =
    useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section =
      sectionRef.current;

    const media =
      mediaRef.current;

    if (!section || !media) {
      return;
    }

    const reducedMotion =
      window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      );

    const mobile =
      window.matchMedia(
        "(max-width: 780px)"
      );

    if (reducedMotion.matches) {
      media.style.setProperty(
        "--surahs-parallax-y",
        "0px"
      );

      return;
    }

    let raf = 0;

    const update = () => {
      raf = 0;

      const rect =
        section.getBoundingClientRect();

      const viewportHeight =
        window.innerHeight;

      const sectionCenter =
        rect.top +
        rect.height / 2;

      const viewportCenter =
        viewportHeight / 2;

      const range =
        (viewportHeight +
          rect.height) /
        2;

      const rawProgress =
        (viewportCenter -
          sectionCenter) /
        range;

      const progress = Math.max(
        -1,
        Math.min(
          1,
          rawProgress
        )
      );

      /*
       * Strongest movement of the four.
       * The star field benefits from the
       * additional sense of depth.
       */
      const distance =
        mobile.matches
          ? 40
          : 72;

      media.style.setProperty(
        "--surahs-parallax-y",
        `${progress * distance}px`
      );
    };

    const requestUpdate = () => {
      if (raf) return;

      raf =
        window.requestAnimationFrame(
          update
        );
    };

    update();

    window.addEventListener(
      "scroll",
      requestUpdate,
      { passive: true }
    );

    window.addEventListener(
      "resize",
      requestUpdate
    );

    mobile.addEventListener(
      "change",
      requestUpdate
    );

    return () => {
      window.removeEventListener(
        "scroll",
        requestUpdate
      );

      window.removeEventListener(
        "resize",
        requestUpdate
      );

      mobile.removeEventListener(
        "change",
        requestUpdate
      );

      if (raf) {
        window.cancelAnimationFrame(
          raf
        );
      }
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="
        content-hero
        surahs-hero
        surahs-hero-with-media
      "
      aria-labelledby="surahs-hero-title"
    >
      <div className="surahs-hero-copy">
        <p className="eyebrow">
          SURAHS
        </p>

        <h1 id="surahs-hero-title">
          Return to the verses.
          <br />

          <em>
            Keep exploring.
          </em>
        </h1>

        <p>
          Explore important and frequently
          revisited Surahs, learn their place in
          the Quran, and continue reading
          from trusted sources.
        </p>
      </div>

      <div
        ref={mediaRef}
        className="surahs-hero-media"
        aria-hidden="true"
      >
        <div className="surahs-hero-media-parallax">
          <Image
            src="/images/surah-stars.webp"
            alt=""
            width={1240}
            height={1240}
            priority
            sizes="
              (max-width: 780px)
              100vw,
              48vw
            "
            className="surahs-hero-image"
          />

          {/*
           * Duplicate real image for positional
           * star halos.
           */}
          <Image
            src="/images/surah-stars.webp"
            alt=""
            width={1240}
            height={1240}
            sizes="
              (max-width: 780px)
              100vw,
              48vw
            "
            className="surahs-hero-image-glow"
          />

          <div className="surahs-hero-image-tone" />

          <div className="surahs-hero-starlight" />

          <div className="surahs-hero-image-vignette" />

          <div className="surahs-hero-image-edge-blur" />
        </div>
      </div>
    </section>
  );
}