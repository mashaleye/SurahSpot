"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";

export function HowItWorksHero() {
  const sectionRef = useRef<HTMLElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const media = mediaRef.current;

    if (!section || !media) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );

    const mobile = window.matchMedia(
      "(max-width: 780px)"
    );

    if (reducedMotion.matches) {
      media.style.setProperty(
        "--how-parallax-y",
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
        rect.top + rect.height / 2;

      const viewportCenter =
        viewportHeight / 2;

      /*
       * Normalized against the complete travel
       * distance of the hero through the viewport.
       */
      const range =
        (viewportHeight + rect.height) / 2;

      const rawProgress =
        (viewportCenter - sectionCenter) /
        range;

      const progress = Math.max(
        -1,
        Math.min(1, rawProgress)
      );

      const distance =
        mobile.matches
          ? 36
          : 64;

      media.style.setProperty(
        "--how-parallax-y",
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
        how-hero
        how-hero-with-media
      "
    >
      <div className="how-hero-copy">
        <p className="eyebrow">
          HOW IT WORKS
        </p>

        <h1>
          Train recognition.
          <br />

          <em>
            Build Qur&rsquo;an anchors.
          </em>
        </h1>

        <p>
          Practice in short, repeatable
          seven-round sessions. Listen closely,
          estimate from memory,
          learn from the reveal, then go again.
        </p>

        <div className="content-hero-actions">
          <Link
            className="primary content-cta"
            href="/"
          >
            Start playing
          </Link>

          <a
            className="secondary-link"
            href="#modes"
          >
            See the modes ↓
          </a>
        </div>
      </div>

      <div
        ref={mediaRef}
        className="how-hero-media"
        aria-hidden="true"
      >
        <div className="how-hero-media-parallax">
          <Image
            src="/images/how-it-works-quran.jpg"
            alt=""
            fill
            priority
            sizes="
              (max-width: 800px)
              100vw,
              48vw
            "
            className="how-hero-image"
          />

          <div className="how-hero-image-tone" />

          <div className="how-hero-image-vignette" />

          <div className="how-hero-image-edge-blur" />
        </div>
      </div>
    </section>
  );
}