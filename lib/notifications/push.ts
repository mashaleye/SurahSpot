import "server-only";

import webpush, { WebPushError } from "web-push";

import { pushConfig } from "@/lib/config/env";
import type { StoredSubscription } from "@/lib/notifications/store";

/**
 * Sending push messages.
 *
 * Thin on purpose: web-push owns the VAPID signing and payload encryption, and
 * everything above this layer deals in "did it land, and should this
 * subscription be kept".
 */

let configured = false;

function ensureConfigured(): boolean {
  const config = pushConfig();
  if (!config.enabled || !config.publicKey || !config.privateKey) return false;

  if (!configured) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    configured = true;
  }
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  category: string;
};

export type PushOutcome =
  /** Delivered, or at least accepted by the push service. */
  | { status: "sent" }
  /** The endpoint is gone for good; the caller should forget this device. */
  | { status: "expired"; code: number }
  /** Transient. Worth keeping the subscription and trying again next slot. */
  | { status: "failed"; code?: number; message: string };

/**
 * A push service that answers 404 or 410 is telling us the subscription is
 * dead — the app was uninstalled, or the browser dropped it. Anything else
 * (429, 5xx, a network blip) is temporary and must not cost the reader their
 * subscription.
 */
function classifyError(error: unknown): PushOutcome {
  if (error instanceof WebPushError) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      return { status: "expired", code: error.statusCode };
    }
    return { status: "failed", code: error.statusCode, message: error.body || error.message };
  }

  return {
    status: "failed",
    message: error instanceof Error ? error.message : "Unknown push failure",
  };
}

export async function sendPush(
  subscription: StoredSubscription,
  payload: PushPayload,
): Promise<PushOutcome> {
  if (!ensureConfigured()) {
    return { status: "failed", message: "Push is not configured on this deployment." };
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      },
      JSON.stringify(payload),
      {
        // Long enough to survive a phone that is briefly offline, short enough
        // that a dua for this morning never lands tomorrow.
        TTL: 3 * 60 * 60,
        urgency: "normal",
      },
    );
    return { status: "sent" };
  } catch (error) {
    return classifyError(error);
  }
}

export function isPushConfigured(): boolean {
  return pushConfig().enabled;
}

export function vapidPublicKey(): string | null {
  return pushConfig().publicKey ?? null;
}
