import { NextRequest, NextResponse } from "next/server";

import { badRequest, toErrorResponse, unavailable } from "@/lib/http/api-error";
import { enforceRateLimit, rateLimitIdentities } from "@/lib/http/rate-limit";
import { rateLimits } from "@/lib/config/env";
import { isPushConfigured, vapidPublicKey } from "@/lib/notifications/push";
import { isValidTimeZone, sanitizePrefs } from "@/lib/notifications/schedule";
import {
  deleteSubscription,
  isPushSubscriptionShape,
  saveSubscription,
  subscriptionId,
  updateSubscriptionState,
} from "@/lib/notifications/store";

export const dynamic = "force-dynamic";

const ROUTE = "api/notifications/subscribe";

/**
 * GET returns what the browser needs to subscribe.
 *
 * The VAPID public key is served rather than bundled so the pair can be
 * rotated without a rebuild, and so a deployment with notifications switched
 * off simply reports that instead of shipping a dead button.
 */
export async function GET() {
  return NextResponse.json(
    { enabled: isPushConfigured(), publicKey: vapidPublicKey() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** POST registers or updates a device's subscription. */
export async function POST(request: NextRequest) {
  try {
    if (!isPushConfigured()) {
      throw unavailable("Notifications are not configured on this deployment.");
    }

    const limits = rateLimits();
    if (limits.enabled) {
      // Subscribing is cheap but writes to shared storage, so it gets the
      // same per-client budget as other write actions.
      await enforceRateLimit("action", rateLimitIdentities(request), limits.actionPerMinute);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") throw badRequest("Expected a JSON body.");

    const { subscription, timeZone, prefs, lastReadDay, streak } = body as {
      subscription?: unknown;
      timeZone?: unknown;
      prefs?: unknown;
      lastReadDay?: unknown;
      streak?: unknown;
    };

    if (!isPushSubscriptionShape(subscription)) {
      throw badRequest("A valid push subscription is required.");
    }

    const record = await saveSubscription({
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      timeZone: isValidTimeZone(timeZone) ? timeZone : "UTC",
      prefs: prefs === undefined ? undefined : sanitizePrefs(prefs),
      lastReadDay: typeof lastReadDay === "string" ? lastReadDay : undefined,
      streak: typeof streak === "number" && Number.isFinite(streak) ? streak : undefined,
    });

    return NextResponse.json(
      { id: record.id, prefs: record.prefs, timeZone: record.timeZone },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, ROUTE);
  }
}

/**
 * PATCH updates the reading state and preferences a subscription carries.
 *
 * The streak reminder depends on whether the reader has read today, which
 * lives on their device. Without this the server would have to guess, and
 * telling someone their streak is at risk when it is not is the fastest way
 * to have notifications switched off for good.
 */
export async function PATCH(request: NextRequest) {
  try {
    const limits = rateLimits();
    if (limits.enabled) {
      await enforceRateLimit("action", rateLimitIdentities(request), limits.actionPerMinute);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") throw badRequest("Expected a JSON body.");

    const { endpoint, prefs, lastReadDay, streak, timeZone } = body as {
      endpoint?: unknown;
      prefs?: unknown;
      lastReadDay?: unknown;
      streak?: unknown;
      timeZone?: unknown;
    };

    if (typeof endpoint !== "string" || !endpoint) throw badRequest("An endpoint is required.");

    const updated = await updateSubscriptionState(subscriptionId(endpoint), {
      prefs: prefs === undefined ? undefined : sanitizePrefs(prefs),
      lastReadDay: typeof lastReadDay === "string" ? lastReadDay : undefined,
      streak: typeof streak === "number" && Number.isFinite(streak) ? streak : undefined,
      timeZone: isValidTimeZone(timeZone) ? timeZone : undefined,
    });

    // A device whose record has expired is not an error worth surfacing; the
    // client re-subscribes and carries on.
    return NextResponse.json(
      { updated: Boolean(updated) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, ROUTE);
  }
}

/** DELETE removes a device, used when the reader turns notifications off. */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const endpoint = (body as { endpoint?: unknown } | null)?.endpoint;
    if (typeof endpoint !== "string" || !endpoint) throw badRequest("An endpoint is required.");

    await deleteSubscription(subscriptionId(endpoint));
    return NextResponse.json({ removed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, ROUTE);
  }
}
