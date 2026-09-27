import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DAILY_AYAH_GOAL,
  LEARNING_PROGRESS_STORAGE_KEY,
  MAX_DAILY_AYAH_GOAL,
  MAX_LIST_ITEMS,
  MIN_DAILY_AYAH_GOAL,
  __resetLearningProgressForTests,
  addLearningListAyah,
  addLearningListSurah,
  ayahListItemId,
  clampGoal,
  clearLearningList,
  computeBestStreak,
  computeStreak,
  getLearningProgressSnapshot,
  hydrateLearningProgress,
  isAyahInLearningList,
  isDayKey,
  isSurahInLearningList,
  learningListAyahSignature,
  localDayKey,
  recentDayKeys,
  recordLearningReading,
  removeLearningListItem,
  surahListItemId,
  sanitizeProgressState,
  seedLearningLastRead,
  setLearningGoal,
  shiftDayKey,
} from "@/lib/learning/progress";

/**
 * The suite runs in Node by design (see vitest.config.ts), so there is no
 * localStorage. The store only needs a Storage-shaped object on globalThis,
 * which is exactly what a browser hands it, so this stub exercises the real
 * persistence path rather than stubbing the module under test.
 */
function installStorageStub() {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() { return entries.size; },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key: string) => { entries.delete(key); },
    setItem: (key: string, value: string) => { entries.set(key, String(value)); },
  };
  (globalThis as { localStorage?: Storage }).localStorage = storage;
  return storage;
}

describe("Learning Blocks day keys", () => {
  it("formats a local calendar day, not a UTC one", () => {
    // 11pm local on the 5th must stay the 5th even though it is the 6th in UTC.
    expect(localDayKey(new Date(2026, 4, 5, 23, 30))).toBe("2026-05-05");
    expect(localDayKey(new Date(2026, 0, 1, 0, 1))).toBe("2026-01-01");
  });

  it("validates day keys and rejects impossible calendar dates", () => {
    expect(isDayKey("2026-02-28")).toBe(true);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("2026-13-01")).toBe(false);
    expect(isDayKey("26-01-01")).toBe(false);
    expect(isDayKey(20260101)).toBe(false);
  });

  it("shifts by whole calendar days across month and year ends", () => {
    expect(shiftDayKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDayKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDayKey("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("shifts exactly one day across a daylight-saving boundary", () => {
    // US DST starts 2026-03-08. Naive 24h arithmetic lands on the wrong day.
    expect(shiftDayKey("2026-03-09", -1)).toBe("2026-03-08");
    expect(shiftDayKey("2026-03-08", -1)).toBe("2026-03-07");
  });

  it("lists the most recent days in chronological order", () => {
    expect(recentDayKeys(3, "2026-05-05")).toEqual(["2026-05-03", "2026-05-04", "2026-05-05"]);
  });
});

describe("Learning Blocks streaks", () => {
  it("counts consecutive days ending today", () => {
    const days = ["2026-05-03", "2026-05-04", "2026-05-05"];
    expect(computeStreak(days, "2026-05-05")).toBe(3);
  });

  it("keeps a streak alive on a day with no reading yet", () => {
    // Opening the app at 9am before reading must not look like a broken streak.
    const days = ["2026-05-03", "2026-05-04"];
    expect(computeStreak(days, "2026-05-05")).toBe(2);
  });

  it("breaks once a whole day has passed with nothing read", () => {
    const days = ["2026-05-03", "2026-05-04"];
    expect(computeStreak(days, "2026-05-06")).toBe(0);
  });

  it("ignores gaps earlier in the history", () => {
    const days = ["2026-04-01", "2026-04-02", "2026-05-04", "2026-05-05"];
    expect(computeStreak(days, "2026-05-05")).toBe(2);
  });

  it("is unaffected by duplicate or unsorted entries", () => {
    const days = ["2026-05-05", "2026-05-03", "2026-05-05", "2026-05-04"];
    expect(computeStreak(days, "2026-05-05")).toBe(3);
  });

  it("returns zero for an empty history", () => {
    expect(computeStreak([], "2026-05-05")).toBe(0);
    expect(computeBestStreak([])).toBe(0);
  });

  it("finds the longest run anywhere in the history", () => {
    const days = [
      "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04",
      "2026-03-10", "2026-03-11",
    ];
    expect(computeBestStreak(days)).toBe(4);
  });
});

describe("Learning Blocks persisted state", () => {
  it("drops entries that could not be navigated to", () => {
    const state = sanitizeProgressState({
      lastRead: { chapterId: 0, verseNumber: 5, pageNumber: 2 },
      days: ["2026-05-05", "nonsense", "2026-02-30"],
      list: [
        { id: "a", kind: "ayah", chapterId: 115, verseNumber: 1, pageNumber: 1 },
        { id: "b", kind: "ayah", chapterId: 2, verseNumber: 0, pageNumber: 1 },
        { id: "c", kind: "ayah", chapterId: 2, verseNumber: 5, pageNumber: 3, createdAt: 10 },
      ],
    });

    expect(state.lastRead).toBeNull();
    expect(state.days).toEqual(["2026-05-05"]);
    expect(state.list).toHaveLength(1);
    expect(state.list[0].chapterId).toBe(2);
  });

  it("survives malformed input without throwing", () => {
    expect(sanitizeProgressState(null).days).toEqual([]);
    expect(sanitizeProgressState("nope").list).toEqual([]);
    expect(sanitizeProgressState({ days: "not-an-array" }).days).toEqual([]);
  });

  it("discards today's Ayah tally when it belongs to another day", () => {
    const state = sanitizeProgressState({ progressDay: "bad", progressKeys: ["2:1", "2:2"] });
    expect(state.progressKeys).toEqual([]);
  });

  it("migrates entries saved before Surahs and Ayahs were distinguished", () => {
    // Older entries have no `kind` and an id of "<chapter>:<verse>". They were
    // all single Ayahs, so they must survive as Ayah entries, re-keyed.
    const state = sanitizeProgressState({
      list: [{ id: "2:255", chapterId: 2, verseNumber: 255, pageNumber: 42, createdAt: 5 }],
    });

    expect(state.list).toHaveLength(1);
    expect(state.list[0]).toMatchObject({ kind: "ayah", chapterId: 2, verseNumber: 255 });
    expect(state.list[0].id).toBe("ayah:2:255");
  });

  it("keeps a saved Surah without a verse number", () => {
    const state = sanitizeProgressState({
      list: [{ id: "surah:18", kind: "surah", chapterId: 18, verseNumber: null, pageNumber: 293, createdAt: 2 }],
    });

    expect(state.list).toHaveLength(1);
    expect(state.list[0]).toMatchObject({ kind: "surah", chapterId: 18, verseNumber: null });
  });

  it("drops an Ayah entry with no usable verse number", () => {
    const state = sanitizeProgressState({
      list: [{ id: "x", kind: "ayah", chapterId: 2, verseNumber: 0, pageNumber: 4, createdAt: 1 }],
    });
    expect(state.list).toEqual([]);
  });

  it("removes duplicate list ids", () => {
    const state = sanitizeProgressState({
      list: [
        { id: "2:5", kind: "ayah", chapterId: 2, verseNumber: 5, pageNumber: 3, createdAt: 2 },
        { id: "2:5", kind: "ayah", chapterId: 2, verseNumber: 5, pageNumber: 3, createdAt: 1 },
      ],
    });
    expect(state.list).toHaveLength(1);
  });

  it("clamps goals into the supported range", () => {
    expect(clampGoal(0)).toBe(MIN_DAILY_AYAH_GOAL);
    expect(clampGoal(5000)).toBe(MAX_DAILY_AYAH_GOAL);
    expect(clampGoal(12.4)).toBe(12);
    expect(clampGoal(Number.NaN)).toBe(DEFAULT_DAILY_AYAH_GOAL);
  });
});

describe("Learning Blocks progress store", () => {
  beforeAll(installStorageStub);

  beforeEach(() => {
    __resetLearningProgressForTests();
    globalThis.localStorage.clear();
    hydrateLearningProgress();
  });

  it("records the reading position and starts a streak", () => {
    recordLearningReading({ chapterId: 3, verseNumber: 198, pageNumber: 76 });
    const snapshot = getLearningProgressSnapshot();

    expect(snapshot.lastRead).toMatchObject({ chapterId: 3, verseNumber: 198, pageNumber: 76 });
    expect(snapshot.streak).toBe(1);
    expect(snapshot.todayCount).toBe(1);
  });

  it("counts each Ayah once toward the daily goal", () => {
    recordLearningReading({ chapterId: 2, verseNumber: 1, pageNumber: 2 });
    recordLearningReading({ chapterId: 2, verseNumber: 2, pageNumber: 2 });
    recordLearningReading({ chapterId: 2, verseNumber: 1, pageNumber: 2 });

    expect(getLearningProgressSnapshot().todayCount).toBe(2);
  });

  it("ignores positions that could not be navigated to", () => {
    recordLearningReading({ chapterId: 200, verseNumber: 1, pageNumber: 1 });
    expect(getLearningProgressSnapshot().lastRead).toBeNull();
  });

  it("keeps the snapshot reference stable when nothing displayed changed", () => {
    recordLearningReading({ chapterId: 2, verseNumber: 5, pageNumber: 3 });
    const first = getLearningProgressSnapshot();
    recordLearningReading({ chapterId: 2, verseNumber: 5, pageNumber: 3 });

    // A repeated position must not produce a new snapshot, or useSyncExternalStore
    // would re-render the hero panel on every scroll frame.
    expect(getLearningProgressSnapshot()).toBe(first);
  });

  it("seeds a last-read position only while none is stored", () => {
    seedLearningLastRead({ chapterId: 18, verseNumber: 10, pageNumber: 294, updatedAt: 1 });
    expect(getLearningProgressSnapshot().lastRead?.chapterId).toBe(18);

    seedLearningLastRead({ chapterId: 36, verseNumber: 1, pageNumber: 440, updatedAt: 2 });
    expect(getLearningProgressSnapshot().lastRead?.chapterId).toBe(18);
  });

  it("stores a goal and reports progress against it", () => {
    setLearningGoal(2);
    recordLearningReading({ chapterId: 1, verseNumber: 1, pageNumber: 1 });

    const snapshot = getLearningProgressSnapshot();
    expect(snapshot.goal?.ayahsPerDay).toBe(2);
    expect(snapshot.todayCount).toBe(1);
  });

  it("adds, de-duplicates, and removes saved Ayahs", () => {
    expect(addLearningListAyah(2, 255, 42)).toBe(true);
    expect(addLearningListAyah(2, 255, 42)).toBe(false);
    expect(getLearningProgressSnapshot().list).toHaveLength(1);

    removeLearningListItem(ayahListItemId(2, 255));
    expect(getLearningProgressSnapshot().list).toHaveLength(0);
  });

  it("adds, de-duplicates, and removes saved Surahs", () => {
    expect(addLearningListSurah(18, 293)).toBe(true);
    expect(addLearningListSurah(18, 293)).toBe(false);
    expect(getLearningProgressSnapshot().list[0]).toMatchObject({ kind: "surah", verseNumber: null });

    removeLearningListItem(surahListItemId(18));
    expect(getLearningProgressSnapshot().list).toHaveLength(0);
  });

  it("keeps a saved Surah and a saved Ayah inside it independent", () => {
    // The bookmark and the medallion are different gestures saving different
    // things; removing one must never quietly remove the other.
    addLearningListSurah(2, 2);
    addLearningListAyah(2, 255, 42);

    expect(isSurahInLearningList(2)).toBe(true);
    expect(isAyahInLearningList(2, 255)).toBe(true);

    removeLearningListItem(surahListItemId(2));
    expect(isSurahInLearningList(2)).toBe(false);
    expect(isAyahInLearningList(2, 255)).toBe(true);
  });

  it("does not treat a saved Ayah as a saved Surah", () => {
    addLearningListAyah(2, 255, 42);
    expect(isSurahInLearningList(2)).toBe(false);
  });

  it("caps the list and keeps the newest entries", () => {
    for (let verse = 1; verse <= MAX_LIST_ITEMS + 5; verse += 1) {
      addLearningListAyah(2, verse, 2);
    }

    const list = getLearningProgressSnapshot().list;
    expect(list).toHaveLength(MAX_LIST_ITEMS);
    expect(list[0].verseNumber).toBe(MAX_LIST_ITEMS + 5);
  });

  it("clears the list", () => {
    addLearningListAyah(2, 255, 42);
    addLearningListSurah(18, 293);
    clearLearningList();
    expect(getLearningProgressSnapshot().list).toHaveLength(0);
  });

  it("signs the saved Ayahs so the reader can compare by value", () => {
    addLearningListAyah(2, 255, 42);
    addLearningListSurah(2, 2);
    addLearningListAyah(18, 10, 294);

    // Surahs are excluded and the order is stable, so an unrelated change
    // cannot make the reader re-render its medallions.
    expect(learningListAyahSignature()).toBe("18:10,2:255");
  });

  it("restores saved progress on the next visit", () => {
    recordLearningReading({ chapterId: 3, verseNumber: 198, pageNumber: 76 });
    setLearningGoal(20);

    __resetLearningProgressForTests();
    hydrateLearningProgress();

    const snapshot = getLearningProgressSnapshot();
    expect(snapshot.lastRead?.chapterId).toBe(3);
    expect(snapshot.goal?.ayahsPerDay).toBe(20);
    expect(snapshot.streak).toBe(1);
  });

  it("counts a streak across consecutive days", () => {
    const yesterday = shiftDayKey(localDayKey(), -1);
    globalThis.localStorage.setItem(
      LEARNING_PROGRESS_STORAGE_KEY,
      JSON.stringify({ days: [yesterday] }),
    );

    __resetLearningProgressForTests();
    hydrateLearningProgress();
    recordLearningReading({ chapterId: 1, verseNumber: 1, pageNumber: 1 });

    expect(getLearningProgressSnapshot().streak).toBe(2);
  });
});
