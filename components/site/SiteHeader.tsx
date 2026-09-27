"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { BrandLockup } from "@/components/BrandLockup";
import { NotificationsMenu } from "@/components/pwa/NotificationsMenu";
import { ThemeToggle } from "@/components/site/ThemeToggle";

type SiteHeaderProps = {
  /**
   * Game-only navigation controls,
   * such as the Modes picker.
   */
  navExtra?: ReactNode;

  /**
   * Context-specific actions such as
   * attempt score/settings on Play.
   */
  actions?: ReactNode;
};

const NAV_ITEMS = [
  {
    href: "/",
    label: "Play",
    exact: true,
  },
  {
    href: "/how-it-works",
    label: "How it works",
  },
  {
    href: "/names-of-allah",
    label: "99 Names",
  },
  {
    href: "/dhikr-duas",
    label: "Dhikr & Duas",
  },
  {
    href: "/surahs",
    label: "Surahs",
  },
] as const;


/* =========================================================
   Active route helper
   ========================================================= */

function isCurrent(
  pathname: string,
  href: string,
  exact = false
) {
  if (exact) {
    return pathname === href;
  }

  return (
    pathname === href ||
    pathname.startsWith(`${href}/`)
  );
}


/* =========================================================
   Shared site header
   ========================================================= */

/**
 * How long after mount the bar ignores scrolling for hide/show purposes.
 *
 * A page that opens part-way down — the browser restoring scroll on reload, a
 * reader returning to a saved position — produces a large scroll before the
 * person has done anything. Treating that as intent would hide the navigation
 * the instant the page appears. Position is still tracked throughout, so the
 * first real gesture after this window measures from the right place.
 */
const SCROLL_SETTLE_MS = 700;

export function SiteHeader({
  navExtra,
  actions,
}: SiteHeaderProps) {
  const pathname = usePathname();
  const [scrollHidden, setScrollHidden] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const lastScrollY = useRef(0);
  const ticking = useRef(false);
  const settledAt = useRef(0);

  useEffect(() => {
    const root = document.documentElement;
    settledAt.current = performance.now() + SCROLL_SETTLE_MS;

    const syncOffset = (hidden?: boolean) => {
      const height = headerRef.current?.offsetHeight ?? 0;
      const isHidden = hidden ?? headerRef.current?.classList.contains("is-scroll-hidden") ?? false;
      root.style.setProperty("--site-header-offset", isHidden ? "0px" : `${height}px`);
    };

    const updateFromScroll = () => {
      const nextY = Math.max(0, window.scrollY);
      const delta = nextY - lastScrollY.current;

      /*
       * A page can move the document by itself — restoring a saved reading
       * position, jumping to a verse. That is the page repositioning the
       * reader, not the reader choosing to scroll, so it must not count as
       * intent to hide the bar. Pages mark those moments by setting
       * data-suppress-header-autohide on <html>; the position is still
       * tracked so the next real gesture measures from the right place.
       */
      if (
        performance.now() < settledAt.current
        || document.documentElement.hasAttribute("data-suppress-header-autohide")
      ) {
        lastScrollY.current = nextY;
        ticking.current = false;
        return;
      }

      // Keep the global header visible at the top of the page. Once the user
      // is reading, content moving upward hides it; reversing direction brings
      // it back without taking the Learning Blocks reader header away.
      if (nextY <= 18) {
        setScrollHidden(false);
      } else if (delta > 7) {
        setScrollHidden(true);
      } else if (delta < -7) {
        setScrollHidden(false);
      }

      lastScrollY.current = nextY;
      ticking.current = false;
    };

    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      window.requestAnimationFrame(updateFromScroll);
    };

    const onResize = () => syncOffset();

    lastScrollY.current = window.scrollY;
    syncOffset(false);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      root.style.removeProperty("--site-header-offset");
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const height = headerRef.current?.offsetHeight ?? 0;
    document.documentElement.style.setProperty(
      "--site-header-offset",
      scrollHidden ? "0px" : `${height}px`,
    );
  }, [scrollHidden]);

  return (
    <header
      ref={headerRef}
      className={`topbar site-topbar ${scrollHidden ? "is-scroll-hidden" : ""}`}
    >
      {/* -----------------------------------------
          Brand
          ----------------------------------------- */}

      <Link
        className="brand"
        href="/"
        aria-label="SurahSpot home"
      >
        <BrandLockup />
      </Link>


      {/* -----------------------------------------
          Horizontally scrollable navigation pills
          ----------------------------------------- */}

      <div
        className="nav-scroll"
        data-testid="primary-nav-scroll"
      >
        <nav
          className="nav-pills"
          aria-label="Primary navigation"
        >
          {NAV_ITEMS.map((item, index) => {
            const current = isCurrent(
              pathname,
              item.href,
              "exact" in item &&
                item.exact
            );

            return (
              <span
                className="nav-slot"
                key={item.href}
              >
                <Link
                  className={
                    current
                      ? "nav-pill active"
                      : "nav-pill"
                  }
                  href={item.href}
                  aria-current={
                    current
                      ? "page"
                      : undefined
                  }
                >
                  {item.label}
                </Link>

                {/*
                 * Keep the Modes control immediately
                 * after Play, exactly as before.
                 */}
                {index === 0
                  ? navExtra
                  : null}
              </span>
            );
          })}
        </nav>
      </div>


      {/* -----------------------------------------
          Persistent actions area

          ThemeToggle hides itself on Play (/),
          so we can safely render it here globally.
          ----------------------------------------- */}

      <div className="header-actions">
        {actions}

        {/* Hides itself when this deployment has no push keys, so it never
            shows a control that does nothing. */}
        <NotificationsMenu />

        <ThemeToggle />
      </div>
    </header>
  );
}