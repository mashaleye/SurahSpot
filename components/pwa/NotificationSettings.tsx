"use client";

/**
 * The reader-facing half of notifications.
 *
 * Deliberately undersold: it lives inside the streak panel rather than
 * greeting anyone on arrival, and permission is only requested on the tap
 * that asks for it. A browser denial cannot be undone from script, so a
 * prompt fired at the wrong moment costs the feature permanently.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPrefs,
} from "@/lib/notifications/schedule";
import {
  currentStatus,
  disableNotifications,
  enableNotifications,
  syncNotificationState,
  writeStoredPrefs,
  type NotificationStatus,
} from "@/lib/pwa/notifications-client";

const CATEGORY_COPY: Record<NotificationCategory, { label: string; hint: string }> = {
  dua: {
    label: "Duas",
    hint: "A Qur'anic supplication every four hours.",
  },
  verse: {
    label: "Verse of the day",
    hint: "One Ayah each morning, with its translation.",
  },
  recitation: {
    label: "Recitation",
    hint: "An afternoon nudge to listen to a Surah.",
  },
  streak: {
    label: "Streak reminder",
    hint: "Only in the evening, and only if you have not read yet.",
  },
};

type Phase = "loading" | "ready" | "working";

export function NotificationSettings({
  streak,
  lastReadDay,
}: {
  streak: number;
  lastReadDay: string | null;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => ({
    dua: true, verse: true, recitation: true, streak: true,
  }));
  const [message, setMessage] = useState("");

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    let cancelled = false;
    void currentStatus().then((next) => {
      if (cancelled) return;
      setStatus(next);
      setPrefs(next.prefs);
      setPhase("ready");
    });
    return () => { cancelled = true; };
  }, []);

  const subscribed = Boolean(status?.subscribed) && status?.permission === "granted";

  const enable = useCallback(async () => {
    setPhase("working");
    setMessage("");

    const result = await enableNotifications(prefs, {
      streak,
      lastReadDay: lastReadDay ?? undefined,
    });

    if (!mountedRef.current) return;

    if (result.ok) {
      setStatus(await currentStatus());
      setMessage("Reminders are on for this device.");
    } else {
      setMessage(
        result.reason === "denied"
          ? "Your browser blocked notifications. You can re-allow them in its site settings."
          : result.reason === "needs-install"
            ? "On iPhone, add SurahSpot to your Home Screen first — Safari only allows notifications for installed apps."
            : result.reason === "unconfigured"
              ? "Notifications are not switched on for this deployment yet."
              : "That did not work. Try again in a moment.",
      );
      // Permission may still have flipped to denied, which changes what we
      // should offer next.
      setStatus(await currentStatus());
    }

    if (mountedRef.current) setPhase("ready");
  }, [lastReadDay, prefs, streak]);

  const disable = useCallback(async () => {
    setPhase("working");
    await disableNotifications();
    if (!mountedRef.current) return;
    setStatus(await currentStatus());
    setMessage("Reminders are off for this device.");
    setPhase("ready");
  }, []);

  const toggleCategory = useCallback((category: NotificationCategory) => {
    setPrefs((previous) => {
      const next = { ...previous, [category]: !previous[category] };
      writeStoredPrefs(next);
      // Only worth a round trip once the device is actually registered;
      // otherwise the choice simply rides along with the first subscribe.
      if (subscribed) void syncNotificationState({ prefs: next });
      return next;
    });
  }, [subscribed]);

  if (phase === "loading") return null;

  if (status?.support === "unsupported") {
    return (
      <p className="learning-modal-lede notif-note">
        This browser cannot show reminders. Reading and streaks work exactly the same without them.
      </p>
    );
  }

  const busy = phase === "working";

  return (
    <section className="notif-panel">
      <header className="notif-head">
        <div>
          <strong>Reminders</strong>
          <small>
            {subscribed
              ? "Sent to this device on its own clock, in your time zone."
              : "Gentle nudges through the day. Nothing is sent until you turn this on."}
          </small>
        </div>

        <button
          type="button"
          className={subscribed ? "notif-toggle is-on" : "notif-toggle"}
          onClick={() => void (subscribed ? disable() : enable())}
          disabled={busy || status?.support === "needs-install"}
          aria-pressed={subscribed}
        >
          {busy ? "…" : subscribed ? "On" : "Turn on"}
        </button>
      </header>

      {subscribed ? (
        <ul className="notif-list">
          {NOTIFICATION_CATEGORIES.map((category) => (
            <li key={category}>
              <label className="notif-row">
                <input
                  type="checkbox"
                  checked={prefs[category]}
                  onChange={() => toggleCategory(category)}
                />
                <span className="notif-row-copy">
                  <strong>{CATEGORY_COPY[category].label}</strong>
                  <small>{CATEGORY_COPY[category].hint}</small>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}

      {message ? <p className="notif-message" role="status">{message}</p> : null}
    </section>
  );
}

export default NotificationSettings;
