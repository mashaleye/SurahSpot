"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

export function DhikrHero() {
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
        "--duas-parallax-y",
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

      const distance =
        mobile.matches
          ? 30
          : 54;

      media.style.setProperty(
        "--duas-parallax-y",
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
        duas-hero
        duas-hero-with-media
      "
      aria-labelledby="duas-hero-title"
    >
      <div className="duas-hero-copy">
        <p className="eyebrow">
          DHIKR &amp; DUAS
        </p>

        <h1 id="duas-hero-title">
          Return often.
          <br />

          <em>
            Keep it intentional.
          </em>
        </h1>

        <p>
          A simple place to organize remembrance
          and supplication study. For wording and
          references, follow the trusted source
          links for the Arabic, context,
          meanings, and translations.
        </p>
      </div>

      <div
        ref={mediaRef}
        className="duas-hero-media"
        aria-hidden="true"
      >
        <div className="duas-hero-media-parallax">
          <Image
            src="/images/tasbih.webp"
            alt=""
            width={1180}
            height={1180}
            priority
            sizes="
              (max-width: 780px)
              100vw,
              44vw
            "
            className="duas-hero-image"
          />

          <div className="duas-hero-image-tone" />

          <div className="duas-hero-image-vignette" />

          <div className="duas-hero-image-edge-blur" />
        </div>
      </div>
    </section>
  );
}