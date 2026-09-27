"use client";

/**
 * The site-wide way in to reminders.
 *
 * Previously the only route to this was Learning Blocks → the streak card →
 * a modal → scroll down, which meant almost nobody would find it. It lives in
 * the header now, on every page.
 *
 * It hides itself completely when this deployment has no push keys or the
 * browser cannot do notifications, rather than showing a control that does
 * nothing when pressed.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { NotificationSettings } from "@/components/pwa/NotificationSettings";
import {
  getLearningProgressSnapshot,
  getLearningProgressServerSnapshot,
  hydrateLearningProgress,
  subscribeLearningProgress,
} from "@/lib/learning/progress";
import { detectSupport } from "@/lib/pwa/notifications-client";

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" fill="none">
      <path
        d="M12 3.2a5.4 5.4 0 0 0-5.4 5.4c0 3.1-.7 4.9-1.5 6a.7.7 0 0 0 .56 1.1h12.68a.7.7 0 0 0 .56-1.1c-.8-1.1-1.5-2.9-1.5-6A5.4 5.4 0 0 0 12 3.2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10 18.2a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function NotificationsMenu() {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  /*
   * Subscribed to as a number, not as the snapshot object. The store notifies
   * on every recorded Ayah while someone is reading; selecting a primitive
   * means this header button re-renders only when the streak actually changes.
   */
  const streak = useSyncExternalStore(
    subscribeLearningProgress,
    () => getLearningProgressSnapshot().streak,
    () => getLearningProgressServerSnapshot().streak,
  );

  const lastReadDay = useSyncExternalStore(
    subscribeLearningProgress,
    () => {
      const days = getLearningProgressSnapshot().days;
      return days.length ? days[days.length - 1] : "";
    },
    () => "",
  );

  /*
   * Show the control only when it can actually do something: the browser
   * supports push (or is an iPhone that would once installed), and the server
   * has keys configured.
   */
  useEffect(() => {
    let cancelled = false;
    hydrateLearningProgress();

    const support = detectSupport();
    if (support === "unsupported") return;

    void fetch("/api/notifications/subscribe", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { enabled: false }))
      .then((config: { enabled?: boolean }) => {
        if (!cancelled && config.enabled) setAvailable(true);
      })
      .catch(() => {
        // No config endpoint, no control. Silence is the right failure here.
      });

    return () => { cancelled = true; };
  }, []);

  /* Dismiss on outside click and on Escape, like the game's settings popover. */
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const toggle = useCallback(() => setOpen((value) => !value), []);

  if (!available) return null;

  return (
    <div className="notif-menu">
      <button
        ref={buttonRef}
        type="button"
        className={`site-theme-toggle notif-menu-trigger ${open ? "is-open" : ""}`}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Reminders"
        title="Reminders"
      >
        <BellIcon />
      </button>

      {open ? (
        <div className="notif-menu-panel" ref={panelRef} role="dialog" aria-label="Reminders">
          <NotificationSettings streak={streak} lastReadDay={lastReadDay || null} />
        </div>
      ) : null}
    </div>
  );
}

export default NotificationsMenu;
