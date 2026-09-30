/**
 * When each kind of notification is due.
 *
 * The day is divided into six four-hour slots in the subscriber's own local
 * time, of which the two small-hours slots are quiet. Every category is pinned
 * to a slot — the remembrance to all the active ones, the rest to one each —
 * so a reader gets a steady rhythm rather than a burst.
 *
 * Everything here is pure and works on an explicit `now`, so the cadence can
 * be tested across days, time zones and daylight-saving boundaries without
 * waiting for real time to pass.
 */

export const NOTIFICATION_CATEGORIES = ["dua", "verse", "recitation", "play", "streak"] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** The six four-hour slots, as the local hour each begins. */
export const SLOT_HOURS = [0, 4, 8, 12, 16, 20] as const;

export type SlotHour = (typeof SLOT_HOURS)[number];

/**
 * Slots in which nothing is sent, whatever is due.
 *
 * The dispatcher runs hourly at :17, so the first delivery in a slot is
 * seventeen minutes past the hour it opens. That put the midnight slot's dua
 * on a phone at 01:44 and would put the four o'clock slot's at 04:17 — the
 * small hours for nearly everyone. Nothing is owed for a quiet slot, so
 * nothing is queued up either: the day starts clean with the 08:00 slot.
 */
export const QUIET_SLOTS: readonly SlotHour[] = [0, 4];

/** The slots that actually deliver, in order. */
export const ACTIVE_SLOTS: readonly SlotHour[] = SLOT_HOURS.filter(
  (slot) => !QUIET_SLOTS.includes(slot),
);

/**
 * Which slots each category fires in.
 *
 * `"every"` means every active slot — one per four-hour window through the
 * day. A number pins the category to a single slot, which is what keeps the
 * daily kinds from arriving several times over. To put any category on the
 * four-hour rhythm, change its value here to `"every"`; nothing else needs to
 * change.
 */
export const CATEGORY_SLOTS: Record<NotificationCategory, "every" | SlotHour> = {
  // A remembrance for each part of the day: a Qur'anic dua, a dhikr or one of
  // the 99 Names, in turn.
  dua: "every",
  // Mid-morning, when there is time to sit with it.
  verse: 8,
  // Midday: a round of the game fits a break better than a reading does.
  play: 12,
  // Late afternoon, a natural point to listen rather than read.
  recitation: 16,
  // Evening, late enough to mean something and early enough to act on.
  streak: 20,
};

export type NotificationPrefs = Record<NotificationCategory, boolean>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  dua: true,
  verse: true,
  recitation: true,
  play: true,
  streak: true,
};

export type SubscriberSchedulingState = {
  /** IANA zone, so slots follow the reader across daylight saving. */
  timeZone: string;
  prefs: NotificationPrefs;
  /** The last slot key already delivered, per category. */
  lastSent: Partial<Record<NotificationCategory, string>>;
  /** Local day of the reader's most recent reading, as YYYY-MM-DD. */
  lastReadDay?: string;
  /** Streak length as the client last reported it. */
  streak?: number;
  /** The Surah the reader last left off in, so the recitation nudge can name it. */
  lastReadChapterId?: number;
};

export type DueNotification = {
  category: NotificationCategory;
  slotKey: string;
  slotHour: SlotHour;
  /** Local day the slot belongs to, as YYYY-MM-DD. */
  localDay: string;
};

/**
 * The reader's local wall-clock parts for an instant.
 *
 * Uses the IANA zone rather than a stored UTC offset: an offset captured at
 * subscribe time is wrong for half the year anywhere that observes daylight
 * saving, which would drift every notification by an hour.
 */
export function localParts(nowMs: number, timeZone: string): { day: string; hour: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(new Date(nowMs));
  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  return {
    day: `${lookup("year")}-${lookup("month")}-${lookup("day")}`,
    hour: Number(lookup("hour")),
  };
}

/** True when the string names a time zone this runtime can resolve. */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The slot an hour falls in: 13:45 belongs to the slot that opened at 12. */
export function slotHourFor(hour: number): SlotHour {
  const floored = Math.floor(hour / 4) * 4;
  return (SLOT_HOURS.find((slot) => slot === floored) ?? 0) as SlotHour;
}

/** Identifies one slot on one local day, e.g. "2026-05-05T12". */
export function slotKey(localDay: string, slot: SlotHour): string {
  return `${localDay}T${String(slot).padStart(2, "0")}`;
}

export function currentSlot(nowMs: number, timeZone: string): { key: string; hour: SlotHour; day: string } {
  const { day, hour } = localParts(nowMs, timeZone);
  const slot = slotHourFor(hour);
  return { key: slotKey(day, slot), hour: slot, day };
}

function firesInSlot(category: NotificationCategory, slot: SlotHour): boolean {
  const rule = CATEGORY_SLOTS[category];
  return rule === "every" || rule === slot;
}

/**
 * Which notifications this subscriber is owed right now.
 *
 * A category is due when it is switched on, fires in the current slot, and
 * has not already been sent for that slot. Recording the slot key rather than
 * a timestamp is what makes delivery idempotent: a dispatch that runs twice,
 * or a cron that fires late, cannot produce a duplicate.
 */
export function dueNotifications(
  state: SubscriberSchedulingState,
  nowMs: number,
): DueNotification[] {
  if (!isValidTimeZone(state.timeZone)) return [];

  const slot = currentSlot(nowMs, state.timeZone);
  if (QUIET_SLOTS.includes(slot.hour)) return [];

  return NOTIFICATION_CATEGORIES.filter((category) => {
    if (!state.prefs?.[category]) return false;
    if (!firesInSlot(category, slot.hour)) return false;
    if (state.lastSent?.[category] === slot.key) return false;

    /*
     * The streak reminder is the one category that is conditional: there is
     * nothing to save if the reader has already read today, and telling them
     * their streak is at risk when it is not is the fastest way to lose the
     * notification permission entirely.
     */
    if (category === "streak") {
      if (state.lastReadDay === slot.day) return false;
      if (!state.streak || state.streak < 1) return false;
    }

    return true;
  }).map((category) => ({
    category,
    slotKey: slot.key,
    slotHour: slot.hour,
    localDay: slot.day,
  }));
}

/** Days since the epoch, from the local day string, so no timezone maths. */
function daysSinceEpoch(localDay: string): number {
  const [year, month, day] = localDay.split("-").map(Number);
  return Math.floor(Date.UTC(year, (month || 1) - 1, day || 1) / 86_400_000);
}

/**
 * The slot's ordinal position among the active slots, counted from the epoch.
 *
 * Every rotation derives from this one number rather than from stored state,
 * so every reader in a time zone sees the same item in the same slot, and a
 * dispatch that runs twice picks the same one. Quiet slots are left out of the
 * count, so a rotation never skips an item on their account.
 */
export function slotPosition(localDay: string, slot: SlotHour): number {
  const slotIndex = ACTIVE_SLOTS.indexOf(slot);
  return daysSinceEpoch(localDay) * ACTIVE_SLOTS.length + (slotIndex < 0 ? 0 : slotIndex);
}

/** A stable index into a content list for a given slot. */
export function contentIndex(localDay: string, slot: SlotHour, listLength: number): number {
  if (listLength <= 0) return 0;
  const position = slotPosition(localDay, slot);
  return ((position % listLength) + listLength) % listLength;
}

/** Same idea, but one step per day: the verse of the day holds all day. */
export function dailyContentIndex(localDay: string, listLength: number): number {
  if (listLength <= 0) return 0;
  const days = daysSinceEpoch(localDay);
  return ((days % listLength) + listLength) % listLength;
}

export function sanitizePrefs(input: unknown): NotificationPrefs {
  const source = (input && typeof input === "object" ? input : {}) as Partial<NotificationPrefs>;
  return NOTIFICATION_CATEGORIES.reduce((prefs, category) => {
    prefs[category] = source[category] !== false;
    return prefs;
  }, {} as NotificationPrefs);
}
