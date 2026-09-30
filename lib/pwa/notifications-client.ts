"use client";

/**
 * The browser half of notifications.
 *
 * Kept out of the components so the permission dance, the subscription
 * lifecycle and the state sync can be reasoned about — and changed — in one
 * place. Everything here is best-effort: a browser that refuses, or a
 * deployment with no keys configured, degrades to the app simply not offering
 * notifications rather than to an error.
 */

import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_CATEGORIES,
  type NotificationPrefs,
} from "@/lib/notifications/schedule";

const PREFS_STORAGE_KEY = "surahspot:notification-prefs:v1";

export type NotificationSupport =
  | "supported"
  | "unsupported"
  /** iOS only exposes push to a PWA that has been added to the home screen. */
  | "needs-install";

export type NotificationStatus = {
  support: NotificationSupport;
  permission: NotificationPermission | "default";
  subscribed: boolean;
  prefs: NotificationPrefs;
};

export function readStoredPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_NOTIFICATION_PREFS };
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    // Only an explicit false switches a kind off, so a category added after
    // the reader last saved their preferences starts on, like the rest.
    return NOTIFICATION_CATEGORIES.reduce((prefs, category) => {
      prefs[category] = parsed[category] !== false;
      return prefs;
    }, {} as NotificationPrefs);
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFS };
  }
}

export function writeStoredPrefs(prefs: NotificationPrefs) {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are a convenience; blocked storage must not break the toggle.
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches
    || (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export function detectSupport(): NotificationSupport {
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    /*
     * Safari on iOS exposes none of this until the app is installed to the
     * home screen, so an iPhone reporting "unsupported" is usually just an
     * uninstalled PWA — worth telling them, rather than saying "not supported".
     */
    const isIos = /iP(hone|ad|od)/.test(navigator.userAgent);
    return isIos && !isStandalone() ? "needs-install" : "unsupported";
  }
  return "supported";
}

/** The VAPID key the server wants us to subscribe with. */
async function fetchPushConfig(): Promise<{ enabled: boolean; publicKey: string | null }> {
  const response = await fetch("/api/notifications/subscribe", { cache: "no-store" });
  if (!response.ok) return { enabled: false, publicKey: null };
  return response.json();
}

/**
 * VAPID keys travel as base64url but subscribe() wants raw bytes.
 *
 * Backed by an explicit ArrayBuffer rather than the Uint8Array(length)
 * shorthand: since TypeScript 5.7 the latter widens to ArrayBufferLike, which
 * no longer satisfies BufferSource.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export async function currentStatus(): Promise<NotificationStatus> {
  const support = detectSupport();
  const prefs = typeof window === "undefined" ? { ...DEFAULT_NOTIFICATION_PREFS } : readStoredPrefs();

  if (support !== "supported") {
    return { support, permission: "default", subscribed: false, prefs };
  }

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();

  return {
    support,
    permission: Notification.permission,
    subscribed: Boolean(subscription),
    prefs,
  };
}

export type EnableResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "needs-install" | "denied" | "unconfigured" | "failed" };

/**
 * Ask for permission and register this device.
 *
 * Permission is requested only when the reader actually asks for
 * notifications — a prompt on page load is the surest way to be denied
 * permanently, and a denial cannot be undone from script.
 */
export async function enableNotifications(
  prefs: NotificationPrefs,
  state: { lastReadDay?: string; streak?: number; lastReadChapterId?: number } = {},
): Promise<EnableResult> {
  const support = detectSupport();
  if (support === "needs-install") return { ok: false, reason: "needs-install" };
  if (support === "unsupported") return { ok: false, reason: "unsupported" };

  const config = await fetchPushConfig();
  if (!config.enabled || !config.publicKey) return { ok: false, reason: "unconfigured" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };

  try {
    const registration = await navigator.serviceWorker.ready;

    const subscription = await registration.pushManager.getSubscription()
      ?? await registration.pushManager.subscribe({
        // Required by Chrome: every push must result in a visible
        // notification, which is what the worker's push handler guarantees.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey),
      });

    const response = await fetch("/api/notifications/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        timeZone: timeZone(),
        prefs,
        ...state,
      }),
    });

    if (!response.ok) return { ok: false, reason: "failed" };

    writeStoredPrefs(prefs);
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function disableNotifications(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;

    // Tell the server first: if unsubscribing locally succeeded but the
    // server still held the record, it would keep pushing to a dead endpoint
    // until the push service expired it.
    await fetch("/api/notifications/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => {});

    await subscription.unsubscribe();
  } catch {
    // Nothing useful to do; the reader's intent is recorded in prefs.
  }
}

/**
 * Push the reader's current reading state to their subscription.
 *
 * Two notifications depend on what happened on the device: the streak
 * reminder needs the last day read and the count, and the afternoon nudge
 * names the Surah the reader left off in. Reading history itself never
 * leaves the device — the position within that Surah stays here, and the
 * link in the nudge resumes it locally.
 */
export async function syncNotificationState(
  state: {
    lastReadDay?: string;
    streak?: number;
    lastReadChapterId?: number;
    prefs?: NotificationPrefs;
  },
): Promise<void> {
  try {
    if (detectSupport() !== "supported") return;
    if (Notification.permission !== "granted") return;

    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;

    await fetch("/api/notifications/subscribe", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        timeZone: timeZone(),
        ...state,
      }),
    });
  } catch {
    // Best effort: a failed sync only means the streak reminder uses slightly
    // older state, which the next sync corrects.
  }
}
