import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

import { AppSplash } from "@/components/AppSplash";
import { siteUrl } from "@/lib/config/site";
import { ServiceWorkerBridge } from "@/components/pwa/ServiceWorkerBridge";
import { StructuredData } from "@/components/site/StructuredData";


export const metadata: Metadata = {
  /*
   * Without this, Next resolves the generated Open Graph images against
   * http://localhost:3000, so every shared link carries an og:image nobody
   * else can load. It fails silently — the page is fine, the card is just
   * blank wherever the link is posted.
   */
  metadataBase: siteUrl(),

  /*
   * The home page's canonical. Every other page sets its own; without one,
   * the same content reachable at more than one URL (a tracking parameter, a
   * stray trailing slash) is treated as duplicates competing with each other.
   */
  alternates: { canonical: "/" },

  title: {
    default: "SurahSpot — Recall · Estimate · Learn",
    template: "%s",
  },

  description:
    "A simple way to practice Surah recognition, Ayah counts, and Qur’an recall in short seven-round sessions.",

  applicationName: "SurahSpot",

  manifest: "/manifest.webmanifest",

  /*
   * Browser auto-translation can rewrite the Arabic
   * and vetted translation, which would corrupt the
   * content and potentially reveal answers.
   */
  other: {
    google: "notranslate",
  },

  icons: {
    icon: [
      {
        url: "/brand/surahspot-mark.svg",
        type: "image/svg+xml",
      },
      {
        url: "/icon-192.png",
        type: "image/png",
        sizes: "192x192",
      },
    ],

    /*
     * iOS home-screen icons need a raster touch icon.
     */
    apple: [
      {
        url: "/apple-touch-icon.png",
        type: "image/png",
        sizes: "180x180",
      },
    ],
  },

  appleWebApp: {
    capable: true,
    title: "SurahSpot",

    /*
     * Keeps the iOS status bar readable against
     * SurahSpot's paper-style light background.
     */
    statusBarStyle: "default",
  },

  formatDetection: {
    /*
     * Prevent iOS from interpreting Ayah numbers,
     * Juz references, etc. as phone numbers,
     * addresses, or dates.
     */
    telephone: false,
    date: false,
    address: false,
  },

  /*
   * Public learning pages are indexable. Shared result and Ayah pages set
   * their own noindex metadata because those links are personal/ephemeral.
   */
  robots: {
    index: true,
    follow: true,
  },
};


export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,

  /*
   * Preserve user zoom for accessibility.
   */
  maximumScale: 5,
  userScalable: true,

  /*
   * Allows layout under notches/home indicators.
   * CSS safe-area variables handle the padding.
   */
  viewportFit: "cover",

  themeColor: [
    {
      media: "(prefers-color-scheme: light)",
      color: "#f5f3ec",
    },
    {
      media: "(prefers-color-scheme: dark)",
      color: "#141714",
    },
  ],
};


/* =========================================================
   iOS PWA startup images
   ========================================================= */

const IOS_STARTUP_IMAGES = [
  [
    "/pwa/splash/iphone-440x956@3x.png",
    "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  ],

  [
    "/pwa/splash/iphone-430x932@3x.png",
    "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  ],

  [
    "/pwa/splash/iphone-402x874@3x.png",
    "(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  ],

  [
    "/pwa/splash/iphone-393x852@3x.png",
    "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  ],

  [
    "/pwa/splash/iphone-390x844@3x.png",
    "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  ],

  [
    "/pwa/splash/iphone-375x812@3x.png",
    "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  ],

  [
    "/pwa/splash/iphone-414x896@2x.png",
    "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
  ],

  [
    "/pwa/splash/iphone-375x667@2x.png",
    "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
  ],

  [
    "/pwa/splash/ipad-1032x1376@2x.png",
    "(device-width: 1032px) and (device-height: 1376px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
  ],

  [
    "/pwa/splash/ipad-1024x1366@2x.png",
    "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
  ],

  [
    "/pwa/splash/ipad-834x1210@2x.png",
    "(device-width: 834px) and (device-height: 1210px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
  ],

  [
    "/pwa/splash/ipad-820x1180@2x.png",
    "(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
  ],

  [
    "/pwa/splash/ipad-768x1024@2x.png",
    "(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
  ],
] as const;


/* =========================================================
   Pre-paint app bootstrap

   1. Resolve the theme before React hydrates.
   2. Determine whether the app is running standalone.
   3. Coordinate the SurahSpot splash.
   ========================================================= */

const APP_BOOTSTRAP = `
(function () {
  var root = document.documentElement;

  /* -------------------------------------------------------
     Theme
     ------------------------------------------------------- */

  try {
    var stored =
      localStorage.getItem("surahspot:theme");

    var mode =
      stored === "light" ||
      stored === "dark" ||
      stored === "system"
        ? stored
        : "system";

    var resolved =
      mode === "system"
        ? (
            window.matchMedia(
              "(prefers-color-scheme: dark)"
            ).matches
              ? "dark"
              : "light"
          )
        : mode;

    root.dataset.theme = resolved;
    root.dataset.themeMode = mode;

    root.style.colorScheme = resolved;
  } catch (error) {
    root.dataset.theme = "light";
    root.dataset.themeMode = "light";
    root.style.colorScheme = "light";
  }


  /* -------------------------------------------------------
     Installed-app splash
     ------------------------------------------------------- */

  try {
    /*
     * Only show the app splash when SurahSpot is
     * launched as an installed web app.
     *
     * ?splash=1 can be used for browser testing.
     */

    var standalone =
      window.navigator.standalone;

    var installed =
      standalone === true ||

      window.matchMedia(
        "(display-mode: standalone)"
      ).matches ||

      window.matchMedia(
        "(display-mode: fullscreen)"
      ).matches ||

      window.matchMedia(
        "(display-mode: minimal-ui)"
      ).matches ||

      /*
       * iOS fallback for versions where
       * navigator.standalone is unreliable.
       */
      (
        standalone === undefined &&
        window.innerHeight ===
          window.screen.height
      ) ||

      location.search.indexOf(
        "splash=1"
      ) !== -1;


    if (!installed) {
      root.dataset.splash = "skip";
      return;
    }

    root.dataset.splash = "active";


    var reduced =
      window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;


    /*
     * Long enough for the logo animation to read,
     * but short enough not to feel like a gate.
     */
    var MIN_MS =
      reduced ? 500 : 2300;


    /*
     * Absolute safety cap.
     * The splash must never trap the user.
     */
    var MAX_MS = 6000;


    /*
     * Measure from first paint rather than script
     * execution because iOS may still be showing
     * its native startup screen at this point.
     */
    var startedAt = null;

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        startedAt = Date.now();
      });
    });


    var done = false;


    function dismiss() {
      if (done) return;

      done = true;

      var el =
        document.getElementById(
          "app-splash"
        );

      if (!el) {
        root.dataset.splash = "done";
        return;
      }

      el.classList.add("is-leaving");


      function finish() {
        /*
         * Hide it, never remove it.
         *
         * The splash markup is rendered by React (AppSplash, a server
         * component inside <body>), so React owns that node. Taking it out of
         * the DOM from here left React's tree describing a child that was no
         * longer there, and the next time it reconciled <body> — which is
         * every client-side navigation — insertBefore and removeChild threw
         * NotFoundError and the whole app died with "a client-side exception".
         *
         * It only ever bit the installed app, because that is the only place
         * this branch runs at all, which is what made it look like a
         * home-screen-only problem.
         *
         * Setting the attribute is sufficient on its own: globals.css hides
         * .app-splash for any html element whose data-splash is not "active".
         */
        root.dataset.splash = "done";
      }


      el.addEventListener(
        "transitionend",
        function (event) {
          /*
           * Child animations also bubble here.
           * Only respond to the overlay's own
           * opacity transition.
           */
          if (
            event.target === el &&
            event.propertyName === "opacity"
          ) {
            finish();
          }
        }
      );


      /*
       * Fallback if transitionend does not fire,
       * including reduced-motion conditions.
       */
      setTimeout(finish, 1200);
    }


    function ready() {
      var elapsed =
        startedAt === null
          ? 0
          : Date.now() - startedAt;

      setTimeout(
        dismiss,
        Math.max(
          0,
          MIN_MS - elapsed
        )
      );
    }


    /*
     * Standard page-ready fallback.
     */
    window.addEventListener(
      "load",
      ready
    );


    /*
     * Optional signal from the game once a
     * playable round is actually ready.
     *
     * The splash remains decoupled from
     * game-state implementation details.
     */
    window.addEventListener(
      "surahspot:ready",
      ready
    );


    /*
     * Hard safety timeout.
     */
    setTimeout(
      dismiss,
      MAX_MS
    );

  } catch (error) {
    root.dataset.splash = "done";
  }
})();
`;


/* =========================================================
   Root layout
   ========================================================= */

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <meta
          name="google"
          content="notranslate"
        />

        {IOS_STARTUP_IMAGES.map(
          ([href, media]) => (
            <link
              key={href}
              rel="apple-touch-startup-image"
              href={href}
              media={media}
            />
          )
        )}

        <script
          dangerouslySetInnerHTML={{
            __html: APP_BOOTSTRAP,
          }}
        />

        <StructuredData />
      </head>

      <body>
        <AppSplash />

        {children}

        <ServiceWorkerBridge />
      </body>
    </html>
  );
}