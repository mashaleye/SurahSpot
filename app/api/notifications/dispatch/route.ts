import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { pushConfig } from "@/lib/config/env";
import { toErrorResponse, unavailable } from "@/lib/http/api-error";
import {
  QURANIC_DUAS,
  RECITATION_SUGGESTIONS,
  VERSE_OF_THE_DAY,
  duaContent,
  recitationContent,
  resolveVerse,
  streakContent,
  verseContent,
  type NotificationContent,
} from "@/lib/notifications/content";
import { sendPush } from "@/lib/notifications/push";
import {
  contentIndex,
  dailyContentIndex,
  dueNotifications,
  type DueNotification,
  type NotificationCategory,
} from "@/lib/notifications/schedule";
import {
  deleteSubscription,
  listSubscriptionIds,
  markDelivered,
  readSubscription,
  type StoredSubscription,
} from "@/lib/notifications/store";

export const dynamic = "force-dynamic";

const ROUTE = "api/notifications/dispatch";

/**
 * How many subscribers are pushed to at once.
 *
 * Push services rate-limit per origin, and a dispatch that opens thousands of
 * sockets at once is the thing most likely to get this sender throttled. A
 * modest pool keeps throughput high without that risk.
 */
const CONCURRENCY = 12;

/**
 * A ceiling on one invocation, so a scheduler that fires late cannot turn into
 * a request that runs for minutes and gets killed half-finished. What is left
 * is picked up by the next run, which is safe because delivery is keyed by
 * slot rather than by time.
 */
const MAX_PER_RUN = 2_000;

/**
 * Constant-time comparison, so a caller cannot learn the secret one character
 * at a time from response timing.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorize(request: NextRequest, expected: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (bearer) return secretMatches(bearer, expected);

  // Some schedulers cannot set headers; a secret in a header is preferred,
  // but this keeps those usable without weakening the comparison.
  const query = request.nextUrl.searchParams.get("secret") ?? "";
  return query ? secretMatches(query, expected) : false;
}

/** Build the message for one due category. */
async function buildContent(
  due: DueNotification,
  subscription: StoredSubscription,
): Promise<NotificationContent | null> {
  if (due.category === "streak") {
    return streakContent(subscription.streak ?? 1);
  }

  if (due.category === "recitation") {
    const index = dailyContentIndex(due.localDay, RECITATION_SUGGESTIONS.length);
    const chapterId = RECITATION_SUGGESTIONS[index];
    // Resolving the first Ayah is the cheapest way to get the Surah's name
    // from the same catalog the reader sees, rather than a second hardcoded list.
    const verse = await resolveVerse({ chapterId, verseNumber: 1 });
    return recitationContent(verse.chapterName, chapterId);
  }

  if (due.category === "verse") {
    const index = dailyContentIndex(due.localDay, VERSE_OF_THE_DAY.length);
    return verseContent(await resolveVerse(VERSE_OF_THE_DAY[index]));
  }

  // Duas step once per slot, so each four-hour window brings a different one.
  const index = contentIndex(due.localDay, due.slotHour, QURANIC_DUAS.length);
  return duaContent(await resolveVerse(QURANIC_DUAS[index]));
}

type RunSummary = {
  considered: number;
  sent: number;
  skipped: number;
  pruned: number;
  failed: number;
};

async function dispatchOne(id: string, nowMs: number, summary: RunSummary): Promise<void> {
  const subscription = await readSubscription(id);
  if (!subscription) {
    // The record expired but the index still lists it; tidy up.
    await deleteSubscription(id);
    summary.pruned += 1;
    return;
  }

  const due = dueNotifications(subscription, nowMs);
  if (!due.length) {
    summary.skipped += 1;
    return;
  }

  const delivered: NotificationCategory[] = [];
  let slotKey = "";

  for (const item of due) {
    slotKey = item.slotKey;

    let content: NotificationContent;
    try {
      const built = await buildContent(item, subscription);
      if (!built) continue;
      content = built;
    } catch {
      // Content could not be resolved — upstream is down, say. Leaving the
      // slot unmarked means the next run retries rather than silently
      // skipping the reader's notification for the day.
      summary.failed += 1;
      continue;
    }

    const outcome = await sendPush(subscription, {
      title: content.title,
      body: content.body,
      url: content.url,
      tag: content.tag,
      category: item.category,
    });

    if (outcome.status === "sent") {
      delivered.push(item.category);
      summary.sent += 1;
    } else if (outcome.status === "expired") {
      // The device is gone. Stop here: the rest of this subscriber's
      // notifications would fail the same way.
      await deleteSubscription(id);
      summary.pruned += 1;
      return;
    } else {
      summary.failed += 1;
    }
  }

  if (delivered.length && slotKey) await markDelivered(id, delivered, slotKey);
}

/**
 * Called by a scheduler, roughly hourly.
 *
 * Running more often than the four-hour slots is not just harmless but
 * desirable: delivery is keyed by slot, so extra runs only pick up readers
 * whose local slot has just opened in another time zone, and a missed run is
 * recovered by the next one.
 */
export async function POST(request: NextRequest) {
  try {
    const config = pushConfig();

    if (!config.enabled) throw unavailable("Notifications are not configured on this deployment.");

    // No secret configured means no safe way to run this, so it refuses
    // rather than allowing anyone to push to every subscriber.
    if (!config.dispatchSecret) {
      throw unavailable("NOTIFICATIONS_DISPATCH_SECRET is not set; dispatch is disabled.");
    }

    if (!authorize(request, config.dispatchSecret)) {
      return NextResponse.json(
        { error: { kind: "unauthorized", message: "Invalid dispatch credentials." } },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const nowMs = Date.now();
    const ids = (await listSubscriptionIds()).slice(0, MAX_PER_RUN);

    const summary: RunSummary = {
      considered: ids.length,
      sent: 0,
      skipped: 0,
      pruned: 0,
      failed: 0,
    };

    // A fixed pool of workers draining a shared cursor: simple, and it keeps
    // exactly CONCURRENCY requests in flight rather than bursting per batch.
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const index = cursor;
        cursor += 1;
        await dispatchOne(ids[index], nowMs, summary);
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));

    return NextResponse.json(
      { ok: true, ...summary, at: new Date(nowMs).toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, ROUTE);
  }
}

/** A scheduler that can only issue GETs works too. */
export async function GET(request: NextRequest) {
  return POST(request);
}
