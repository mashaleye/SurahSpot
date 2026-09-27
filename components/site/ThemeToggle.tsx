"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Theme = "light" | "dark";

const STORAGE_KEY = "surahspot:theme";

export function ThemeToggle() {
  const pathname = usePathname();

  const [theme, setTheme] = useState<Theme | null>(
    null
  );

  /*
   * Don't show the navbar theme toggle on Play.
   * "/" is the current game route.
   *
   * /play is included in case the game is moved
   * to its own route later.
   */
  const isPlayPage =
    pathname === "/" ||
    pathname === "/play" ||
    pathname.startsWith("/play/");

  /*
   * APP_BOOTSTRAP in layout.tsx has already
   * resolved the theme before React hydrates.
   *
   * So instead of recalculating it here, read
   * the already-resolved value from <html>.
   */
  useEffect(() => {
    const root = document.documentElement;

    const resolved: Theme =
      root.dataset.theme === "dark"
        ? "dark"
        : "light";

    setTheme(resolved);

    /*
     * Keep this component synchronized if the
     * theme is changed in another browser tab.
     */
    const handleStorage = (
      event: StorageEvent
    ) => {
      if (
        event.key !== STORAGE_KEY ||
        !event.newValue
      ) {
        return;
      }

      let next: Theme;

      if (event.newValue === "dark") {
        next = "dark";
      } else if (
        event.newValue === "light"
      ) {
        next = "light";
      } else {
        /*
         * "system" is supported by the app
         * bootstrap even though this button only
         * directly toggles light/dark.
         */
        next = window.matchMedia(
          "(prefers-color-scheme: dark)"
        ).matches
          ? "dark"
          : "light";
      }

      root.dataset.theme = next;
      root.dataset.themeMode =
        event.newValue;

      root.style.colorScheme = next;

      setTheme(next);
    };

    window.addEventListener(
      "storage",
      handleStorage
    );

    return () => {
      window.removeEventListener(
        "storage",
        handleStorage
      );
    };
  }, []);

  /*
   * Prevent hydration mismatch and hide
   * completely on the Play page.
   */
  if (isPlayPage || theme === null) {
    return null;
  }

  function toggleTheme() {
    const next: Theme =
      theme === "dark"
        ? "light"
        : "dark";

    const root =
      document.documentElement;

    /*
     * Update DOM immediately so there is
     * no visual delay waiting for React.
     */
    root.dataset.theme = next;
    root.dataset.themeMode = next;

    root.style.colorScheme = next;

    /*
     * Same key used by APP_BOOTSTRAP in
     * app/layout.tsx.
     */
    localStorage.setItem(
      STORAGE_KEY,
      next
    );

    setTheme(next);
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className="site-theme-toggle"
      onClick={toggleTheme}
      aria-label={
        isDark
          ? "Switch to light mode"
          : "Switch to dark mode"
      }
      title={
        isDark
          ? "Switch to light mode"
          : "Switch to dark mode"
      }
    >
      <span
        className="site-theme-toggle-icon"
        aria-hidden="true"
      >
        {isDark ? (
          <SunIcon />
        ) : (
          <MoonIcon />
        )}
      </span>
    </button>
  );
}


/* =========================================================
   Icons
   ========================================================= */

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      <circle
        cx="12"
        cy="12"
        r="4"
      />

      <path d="M12 2v2" />
      <path d="M12 20v2" />

      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />

      <path d="M2 12h2" />
      <path d="M20 12h2" />

      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}


function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      <path
        d="
          M21 12.79
          A9 9 0 1 1 11.21 3
          a7 7 0 0 0 9.79 9.79Z
        "
      />
    </svg>
  );
}