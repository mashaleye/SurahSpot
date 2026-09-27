import { createHash } from "node:crypto";

import { getStore } from "@/lib/store";
import {
  DEFAULT_NOTIFICATION_PREFS,
  isValidTimeZone,
  sanitizePrefs,
  type NotificationCategory,
  type NotificationPrefs,
} from "@/lib/notifications/schedule";

/**
 * Where push subscriptions live.
 *
 * Built on the same KeyValueStore the game state uses, so a deployment that
 * has Redis configured gets durable, shared subscriptions across replicas and
 * one that has not still works on a single process. Nothing here knows which.
 *
 * The store has no key scan, so an explicit index holds the set of
 * subscription ids. Every mutation of that index runs under the store's lock,
 * because two devices subscribing at once is ordinary behaviour, not an error.
 */

const SUBSCRIPTION_PREFIX = "notif:sub:";
const INDEX_KEY = "notif:index";

/**
 * Subscriptions expire if a device stops checking in for this long. Push
 * endpoints for uninstalled apps would otherwise accumulate forever, and each
 * one costs a wasted request on every dispatch.
 */
const SUBSCRIPTION_TTL_MS = 180 * 24 * 60 * 60_000;

/**
 * A ceiling on the index, so a runaway client cannot grow it without bound.
 * A deployment expecting more than this wants sharded index keys; the shape
 * here is deliberately simple rather than clever.
 */
const MAX_TRACKED_SUBSCRIPTIONS = 50_000;

export type PushSubscriptionKeys = {
  p256dh: string;
  auth: string;
};

export type StoredSubscription = {
  id: string;
  endpoint: string;
  keys: PushSubscriptionKeys;
  timeZone: string;
  prefs: NotificationPrefs;
  /** Slot key last delivered, per category, for idempotent dispatch. */
  lastSent: Partial<Record<NotificationCategory, string>>;
  /** Local day of the reader's most recent reading, as YYYY-MM-DD. */
  lastReadDay?: string;
  streak?: number;
  createdAt: number;
  updatedAt: number;
};

/**
 * The id is derived from the endpoint rather than random, so a device that
 * re-subscribes updates its record instead of creating a duplicate that would
 * deliver every notification twice.
 */
export function subscriptionId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
}

function subscriptionKey(id: string): string {
  return `${SUBSCRIPTION_PREFIX}${id}`;
}

export async function listSubscriptionIds(): Promise<string[]> {
  const index = await getStore().get<string[]>(INDEX_KEY);
  return Array.isArray(index) ? index : [];
}

export async function readSubscription(id: string): Promise<StoredSubscription | null> {
  return getStore().get<StoredSubscription>(subscriptionKey(id));
}

async function addToIndex(id: string) {
  const store = getStore();
  await store.withLock(INDEX_KEY, async () => {
    const index = (await store.get<string[]>(INDEX_KEY)) ?? [];
    if (index.includes(id)) return;
    if (index.length >= MAX_TRACKED_SUBSCRIPTIONS) return;
    await store.set(INDEX_KEY, [...index, id], SUBSCRIPTION_TTL_MS);
  });
}

async function removeFromIndex(id: string) {
  const store = getStore();
  await store.withLock(INDEX_KEY, async () => {
    const index = (await store.get<string[]>(INDEX_KEY)) ?? [];
    const next = index.filter((entry) => entry !== id);
    if (next.length === index.length) return;
    await store.set(INDEX_KEY, next, SUBSCRIPTION_TTL_MS);
  });
}

export type SaveSubscriptionInput = {
  endpoint: string;
  keys: PushSubscriptionKeys;
  timeZone: string;
  prefs?: unknown;
  lastReadDay?: string;
  streak?: number;
};

/** Validates the shape a browser's PushSubscription serialises to. */
export function isPushSubscriptionShape(value: unknown): value is {
  endpoint: string;
  keys: PushSubscriptionKeys;
} {
  const candidate = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  return Boolean(
    candidate
    && typeof candidate.endpoint === "string"
    && /^https:\/\//.test(candidate.endpoint)
    && candidate.endpoint.length <= 2048
    && candidate.keys
    && typeof candidate.keys.p256dh === "string"
    && typeof candidate.keys.auth === "string",
  );
}

export async function saveSubscription(input: SaveSubscriptionInput): Promise<StoredSubscription> {
  const id = subscriptionId(input.endpoint);
  const existing = await readSubscription(id);
  const now = Date.now();

  const record: StoredSubscription = {
    id,
    endpoint: input.endpoint,
    keys: input.keys,
    timeZone: isValidTimeZone(input.timeZone) ? input.timeZone : "UTC",
    prefs: input.prefs === undefined
      ? existing?.prefs ?? DEFAULT_NOTIFICATION_PREFS
      : sanitizePrefs(input.prefs),
    // Delivery history survives a re-subscribe, so rotating an endpoint does
    // not replay a slot the reader has already been sent.
    lastSent: existing?.lastSent ?? {},
    lastReadDay: input.lastReadDay ?? existing?.lastReadDay,
    streak: input.streak ?? existing?.streak,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await getStore().set(subscriptionKey(id), record, SUBSCRIPTION_TTL_MS);
  await addToIndex(id);
  return record;
}

/**
 * Update the reading state a subscription carries. Called by the client when
 * its streak changes, because the streak reminder must not fire for someone
 * who has already read today and the server has no other way to know.
 */
export async function updateSubscriptionState(
  id: string,
  patch: { lastReadDay?: string; streak?: number; prefs?: unknown; timeZone?: string },
): Promise<StoredSubscription | null> {
  const store = getStore();

  return store.withLock(subscriptionKey(id), async () => {
    const existing = await store.get<StoredSubscription>(subscriptionKey(id));
    if (!existing) return null;

    const next: StoredSubscription = {
      ...existing,
      lastReadDay: patch.lastReadDay ?? existing.lastReadDay,
      streak: patch.streak ?? existing.streak,
      prefs: patch.prefs === undefined ? existing.prefs : sanitizePrefs(patch.prefs),
      timeZone: isValidTimeZone(patch.timeZone) ? patch.timeZone : existing.timeZone,
      updatedAt: Date.now(),
    };

    await store.set(subscriptionKey(id), next, SUBSCRIPTION_TTL_MS);
    return next;
  });
}

/** Record that a slot has been delivered, so a re-run cannot duplicate it. */
export async function markDelivered(
  id: string,
  categories: NotificationCategory[],
  slotKey: string,
): Promise<void> {
  if (!categories.length) return;
  const store = getStore();

  await store.withLock(subscriptionKey(id), async () => {
    const existing = await store.get<StoredSubscription>(subscriptionKey(id));
    if (!existing) return;

    const lastSent = { ...existing.lastSent };
    for (const category of categories) lastSent[category] = slotKey;

    await store.set(
      subscriptionKey(id),
      { ...existing, lastSent, updatedAt: Date.now() },
      SUBSCRIPTION_TTL_MS,
    );
  });
}

export async function deleteSubscription(id: string): Promise<void> {
  await getStore().delete(subscriptionKey(id));
  await removeFromIndex(id);
}
