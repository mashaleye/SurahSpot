import { describe, expect, it } from "vitest";
import {
  CATEGORY_SLOTS,
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_CATEGORIES,
  SLOT_HOURS,
  contentIndex,
  dailyContentIndex,
  dueNotifications,
  isValidTimeZone,
  localParts,
  sanitizePrefs,
  slotHourFor,
  slotKey,
  type SubscriberSchedulingState,
} from "@/lib/notifications/schedule";

/** A subscriber in Los Angeles with everything switched on and nothing sent. */
function subscriber(overrides: Partial<SubscriberSchedulingState> = {}): SubscriberSchedulingState {
  return {
    timeZone: "America/Los_Angeles",
    prefs: { ...DEFAULT_NOTIFICATION_PREFS },
    lastSent: {},
    lastReadDay: undefined,
    streak: 3,
    ...overrides,
  };
}

/** An instant expressed in a reader's local wall clock. */
function at(timeZone: string, iso: string): number {
  // Interpret the ISO string as UTC, then correct by the zone's offset at that
  // moment so the wall clock lands where the test intends.
  const naive = Date.parse(`${iso}Z`);
  const shown = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(naive));
  const get = (t: string) => Number(shown.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return naive + (naive - asUtc);
}

describe("notification slots", () => {
  it("divides the day into six four-hour slots", () => {
    expect(SLOT_HOURS).toEqual([0, 4, 8, 12, 16, 20]);
  });

  it("puts an hour in the slot that opened before it", () => {
    expect(slotHourFor(0)).toBe(0);
    expect(slotHourFor(3)).toBe(0);
    expect(slotHourFor(4)).toBe(4);
    expect(slotHourFor(13)).toBe(12);
    expect(slotHourFor(23)).toBe(20);
  });

  it("reads the local day and hour in the reader's zone, not UTC", () => {
    // 03:00 UTC is still the previous evening in Los Angeles.
    const utcMorning = Date.parse("2026-05-05T03:00:00Z");
    expect(localParts(utcMorning, "America/Los_Angeles").day).toBe("2026-05-04");
    expect(localParts(utcMorning, "UTC").day).toBe("2026-05-05");
  });

  it("validates time zones", () => {
    expect(isValidTimeZone("America/Los_Angeles")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});

describe("what is due", () => {
  it("sends a dua in every slot", () => {
    expect(CATEGORY_SLOTS.dua).toBe("every");

    for (const hour of SLOT_HOURS) {
      const now = at("America/Los_Angeles", `2026-05-05T${String(hour).padStart(2, "0")}:05:00`);
      const due = dueNotifications(subscriber({ lastReadDay: "2026-05-05" }), now);
      expect(due.some((item) => item.category === "dua")).toBe(true);
    }
  });

  it("sends the daily kinds only in their own slot", () => {
    const morning = at("America/Los_Angeles", "2026-05-05T08:30:00");
    const categories = dueNotifications(subscriber({ lastReadDay: "2026-05-05" }), morning)
      .map((item) => item.category);

    expect(categories).toContain("verse");
    expect(categories).not.toContain("recitation");
    expect(categories).not.toContain("streak");
  });

  it("does not repeat a category within the same slot", () => {
    const now = at("America/Los_Angeles", "2026-05-05T08:30:00");
    const state = subscriber({ lastReadDay: "2026-05-05" });
    const first = dueNotifications(state, now);
    expect(first.length).toBeGreaterThan(0);

    // Mark everything delivered for this slot, as dispatch would.
    for (const item of first) state.lastSent[item.category] = item.slotKey;

    // A dispatcher that runs twice, or fires late, must not send again.
    expect(dueNotifications(state, now)).toEqual([]);
    expect(dueNotifications(state, now + 40 * 60_000)).toEqual([]);
  });

  it("sends again once the next slot opens", () => {
    const state = subscriber({ lastReadDay: "2026-05-05" });
    const noon = at("America/Los_Angeles", "2026-05-05T12:10:00");
    for (const item of dueNotifications(state, noon)) state.lastSent[item.category] = item.slotKey;

    const afternoon = at("America/Los_Angeles", "2026-05-05T16:10:00");
    expect(dueNotifications(state, afternoon).map((i) => i.category)).toContain("dua");
  });

  it("respects a category being switched off", () => {
    const now = at("America/Los_Angeles", "2026-05-05T08:30:00");
    const state = subscriber({
      lastReadDay: "2026-05-05",
      prefs: { ...DEFAULT_NOTIFICATION_PREFS, dua: false },
    });

    const categories = dueNotifications(state, now).map((item) => item.category);
    expect(categories).not.toContain("dua");
    expect(categories).toContain("verse");
  });

  it("holds the streak reminder when the reader has already read today", () => {
    const evening = at("America/Los_Angeles", "2026-05-05T20:30:00");

    const read = dueNotifications(subscriber({ lastReadDay: "2026-05-05" }), evening);
    expect(read.map((i) => i.category)).not.toContain("streak");

    const notRead = dueNotifications(subscriber({ lastReadDay: "2026-05-04" }), evening);
    expect(notRead.map((i) => i.category)).toContain("streak");
  });

  it("does not nag about a streak that does not exist", () => {
    const evening = at("America/Los_Angeles", "2026-05-05T20:30:00");
    const state = subscriber({ lastReadDay: "2026-05-04", streak: 0 });
    expect(dueNotifications(state, evening).map((i) => i.category)).not.toContain("streak");
  });

  it("returns nothing for an unusable time zone", () => {
    const now = Date.now();
    expect(dueNotifications(subscriber({ timeZone: "Nowhere/Void" }), now)).toEqual([]);
  });

  it("follows the reader's zone, so the same instant differs by location", () => {
    // 16:30 in Los Angeles is 00:30 the next day in London.
    const instant = at("America/Los_Angeles", "2026-05-05T16:30:00");

    const la = dueNotifications(subscriber({ lastReadDay: "2026-05-05" }), instant);
    const london = dueNotifications(
      subscriber({ timeZone: "Europe/London", lastReadDay: "2026-05-06" }),
      instant,
    );

    expect(la.map((i) => i.category)).toContain("recitation");
    expect(london.map((i) => i.category)).not.toContain("recitation");
    expect(london[0]?.localDay).toBe("2026-05-06");
  });

  it("keeps slots aligned across a daylight-saving change", () => {
    // US clocks go forward on 2026-03-08. The 12:00 slot must still be the
    // reader's noon on both sides of it, not 11:00 or 13:00.
    for (const day of ["2026-03-07", "2026-03-09"]) {
      const now = at("America/Los_Angeles", `${day}T12:30:00`);
      const due = dueNotifications(subscriber({ lastReadDay: day }), now);
      expect(due[0]?.slotKey).toBe(slotKey(day, 12));
    }
  });
});

describe("content selection", () => {
  it("is stable for a slot, so a re-run picks the same item", () => {
    const first = contentIndex("2026-05-05", 12, 30);
    expect(contentIndex("2026-05-05", 12, 30)).toBe(first);
  });

  it("moves on with each slot", () => {
    const morning = contentIndex("2026-05-05", 8, 30);
    const noon = contentIndex("2026-05-05", 12, 30);
    expect(noon).not.toBe(morning);
  });

  it("holds the verse of the day steady all day, then changes", () => {
    expect(dailyContentIndex("2026-05-05", 33)).toBe(dailyContentIndex("2026-05-05", 33));
    expect(dailyContentIndex("2026-05-06", 33)).not.toBe(dailyContentIndex("2026-05-05", 33));
  });

  it("stays inside the list", () => {
    for (const day of ["2026-01-01", "2026-06-15", "2027-12-31"]) {
      for (const slot of SLOT_HOURS) {
        const index = contentIndex(day, slot, 7);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(7);
      }
    }
  });

  it("copes with an empty list rather than dividing by zero", () => {
    expect(contentIndex("2026-05-05", 8, 0)).toBe(0);
    expect(dailyContentIndex("2026-05-05", 0)).toBe(0);
  });
});

describe("preferences", () => {
  it("defaults every category on, and only accepts an explicit false", () => {
    expect(sanitizePrefs({})).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(sanitizePrefs(null).dua).toBe(true);
    expect(sanitizePrefs({ dua: false }).dua).toBe(false);
    expect(sanitizePrefs({ dua: "no" }).dua).toBe(true);
  });

  it("ignores categories it does not know", () => {
    const prefs = sanitizePrefs({ dua: false, nonsense: true });
    expect(Object.keys(prefs).sort()).toEqual([...NOTIFICATION_CATEGORIES].sort());
  });
});
