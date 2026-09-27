"use client";

/**
 * Registers the service worker and surfaces the two things a reader should
 * know about it: that the connection dropped, and that a new version is ready.
 *
 * Neither is an interruption. The offline note appears only once something
 * actually needs the network, and an update is never applied under the
 * reader — the worker waits until they tap, so a page cannot swap out
 * mid-Ayah.
 *
 * Renders nothing at all in development: the dev server serves every chunk
 * from a URL that changes on each edit, so a worker caching them makes hot
 * reload behave like a haunted house.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Long enough that a flaky tunnel does not flash a banner on every blip. */
const OFFLINE_ANNOUNCE_DELAY_MS = 1_200;

function shouldRegister(): boolean {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;

  if (process.env.NODE_ENV === "production") return true;

  // An escape hatch for checking offline behaviour against a dev server.
  try {
    return localStorage.getItem("surahspot:sw-dev") === "1";
  } catch {
    return false;
  }
}

export function ServiceWorkerBridge() {
  const [updateReady, setUpdateReady] = useState(false);
  const [offline, setOffline] = useState(false);

  const waitingRef = useRef<ServiceWorker | null>(null);
  const reloadingRef = useRef(false);

  /*
   * Whether the reader has actually asked for an update to be applied.
   *
   * This gates the reload below, and it has to, because `controllerchange` is
   * not only an update signal. See onControllerChange for the first-visit case
   * it otherwise catches.
   */
  const updateRequestedRef = useRef(false);

  /* ---------------------------------------------------------------
     Registration
     --------------------------------------------------------------- */

  useEffect(() => {
    if (!shouldRegister()) return;

    let cancelled = false;

    const watchInstalling = (registration: ServiceWorkerRegistration) => {
      const installing = registration.installing;
      if (!installing) return;

      installing.addEventListener("statechange", () => {
        /*
         * `controller` is null on the very first visit, where installing
         * means "this app now works offline" rather than "there is a newer
         * version". Prompting then would be asking the reader to refresh a
         * page they just opened.
         */
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          waitingRef.current = installing;
          if (!cancelled) setUpdateReady(true);
        }
      });
    };

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (cancelled) return;

        if (registration.waiting && navigator.serviceWorker.controller) {
          waitingRef.current = registration.waiting;
          setUpdateReady(true);
        }

        watchInstalling(registration);
        registration.addEventListener("updatefound", () => watchInstalling(registration));

        /*
         * Check for a new worker when the app comes back to the foreground.
         * An installed PWA can live for weeks without a cold start, which is
         * exactly the case where a stale worker would otherwise persist.
         */
        const recheck = () => {
          if (document.visibilityState === "visible") registration.update().catch(() => {});
        };
        document.addEventListener("visibilitychange", recheck);
        return () => document.removeEventListener("visibilitychange", recheck);
      } catch {
        // A blocked or unsupported worker just means no offline support.
        return undefined;
      }
    };

    /*
     * Registration competes with the first render for bandwidth and main
     * thread, and nothing on screen depends on it, so it waits for load.
     */
    let teardown: (() => void) | undefined;
    const start = () => { void register().then((cleanup) => { teardown = cleanup; }); };

    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });

    const onControllerChange = () => {
      /*
       * Only reload for an update the reader asked for.
       *
       * `controllerchange` has two causes, and this handler used to treat them
       * as one:
       *
       *  1. SKIP_WAITING took effect, because the reader tapped Refresh. The
       *     page is now running against a worker it was not loaded with, so a
       *     reload is the point.
       *  2. The FIRST EVER visit. sw.js calls clients.claim() on activate, so
       *     the controller goes from null to the new worker while the page is
       *     already loaded and perfectly fine.
       *
       * Reloading on (2) meant every first-time visitor silently loaded the
       * entire page twice. It cost 2.1s on a throttled mobile connection, ran
       * all the app's JavaScript a second time, and was the single largest
       * item in a mobile Lighthouse run — while being invisible in testing,
       * because a second visit already has a controller and never triggers it.
       *
       * The update prompt above is guarded the same way, via
       * `navigator.serviceWorker.controller`. This is the other half of it.
       */
      if (!updateRequestedRef.current) return;

      // Guarded separately because Chrome can fire this more than once, and a
      // reload loop is unrecoverable from inside the page.
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      cancelled = true;
      window.removeEventListener("load", start);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      teardown?.();
    };
  }, []);

  /* ---------------------------------------------------------------
     Connection state
     --------------------------------------------------------------- */

  useEffect(() => {
    if (typeof window === "undefined") return;

    let timer: number | undefined;

    const settle = () => {
      window.clearTimeout(timer);
      if (navigator.onLine) {
        setOffline(false);
        return;
      }
      timer = window.setTimeout(() => setOffline(true), OFFLINE_ANNOUNCE_DELAY_MS);
    };

    settle();
    window.addEventListener("online", settle);
    window.addEventListener("offline", settle);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", settle);
      window.removeEventListener("offline", settle);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    const waiting = waitingRef.current;
    setUpdateReady(false);

    // Set before postMessage, not after: the worker can take over and fire
    // controllerchange before this function returns, and the handler reads
    // this flag to decide whether the change was asked for.
    updateRequestedRef.current = true;

    if (!waiting) {
      window.location.reload();
      return;
    }
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, []);

  if (!updateReady && !offline) return null;

  return (
    <div className="pwa-bridge" role="status" aria-live="polite">
      {offline ? (
        <p className="pwa-bridge-note">
          <span className="pwa-bridge-dot" aria-hidden="true" />
          Offline — Surahs you have already opened are still available.
        </p>
      ) : null}

      {updateReady ? (
        <p className="pwa-bridge-note">
          A new version of SurahSpot is ready.
          <button type="button" className="pwa-bridge-action" onClick={applyUpdate}>
            Refresh
          </button>
        </p>
      ) : null}
    </div>
  );
}

export default ServiceWorkerBridge;
