"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

export function NamesHero() {
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
        "--names-parallax-y",
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
        (viewportHeight + rect.height) /
        2;

      const rawProgress =
        (viewportCenter - sectionCenter) /
        range;

      const progress = Math.max(
        -1,
        Math.min(
          1,
          rawProgress
        )
      );

      /*
       * Stronger than before but slightly
       * calmer than the space hero because
       * the calligraphy is the focal point.
       */
      const distance =
        mobile.matches
          ? 32
          : 58;

      media.style.setProperty(
        "--names-parallax-y",
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
        names-hero
        names-hero-with-media
      "
      aria-labelledby="names-hero-title"
    >
      <div className="names-hero-copy">
        <p className="eyebrow">
          AL-ASMA&rsquo; AL-HUSNA
        </p>

        <h1 id="names-hero-title">
          The Beautiful Names.
          <br />

          <em>
            Read with intention.
          </em>
        </h1>

        <p>
          Browse the 99 Names in Arabic with
          transliteration and concise translated
          meanings. Translation wording can vary
          by source, so treat these as learning
          aids rather than exhaustive explanations
          of the attributes.
        </p>
      </div>

      <div
        ref={mediaRef}
        className="names-hero-media"
        aria-hidden="true"
      >
        <div className="names-hero-media-parallax">
          <Image
            src="/images/names-of-allah-hero.jpg"
            alt=""
            width={800}
            height={1600}
            priority
            sizes="
              (max-width: 780px)
              100vw,
              48vw
            "
            className="names-hero-image"
          />

          <div className="names-hero-image-tone" />

          <div className="names-hero-image-halo" />

          <div className="names-hero-image-focus" />

          <div className="names-hero-image-vignette" />

          <div className="names-hero-image-edge-blur" />
        </div>
      </div>
    </section>
  );
}