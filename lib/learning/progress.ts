/**
 * Learning Blocks progress: last read, daily streak, daily goal, and My List.
 *
 * This lives outside the reader component on purpose. The reader keeps its
 * reading positions in refs so that scrolling a long Surah never re-renders
 * hundreds of Ayah nodes. If the hero cards read that state through ordinary
 * React state, every scroll frame would re-render the whole reader and undo
 * that. Instead the reader pushes updates into this store and only the
 * subscribed hero panel re-renders.
 *
 * The snapshot is referentially stable between real changes so
 * `useSyncExternalStore` does not loop.
 */

export const LEARNING_PROGRESS_STORAGE_KEY = "surahspot:learning-progress:v1";

/** Days kept for streak maths. Comfortably over a year of history. */
const MAX_TRACKED_DAYS = 400;

/** Distinct Ayahs remembered for today's goal progress. */
const MAX_DAILY_AYAH_KEYS = 2000;

/** My List is a hand-curated shortlist, not an archive. */
export const MAX_LIST_ITEMS = 60;

export const DEFAULT_DAILY_AYAH_GOAL = 10;
export const MIN_DAILY_AYAH_GOAL = 1;
export const MAX_DAILY_AYAH_GOAL = 300;

export type LearningLastRead = {
  chapterId: number;
  verseNumber: number;
  pageNumber: number;
  updatedAt: number;
};

/**
 * My List holds two different things, and they are saved by two different
 * gestures: the bookmark in the reader chrome saves a whole Surah, and an
 * Ayah medallion saves that one Ayah. They are independent — removing a
 * Surah never touches the Ayahs saved inside it.
 */
export type LearningListKind = "surah" | "ayah";

export type LearningListItem = {
  id: string;
  kind: LearningListKind;
  chapterId: number;
  /** The exact Ayah for an "ayah" entry; null when the whole Surah is saved. */
  verseNumber: number | null;
  pageNumber: number;
  note: string;
  createdAt: number;
};

export type LearningGoal = {
  ayahsPerDay: number;
  updatedAt: number;
};

export type LearningProgressSnapshot = {
  hydrated: boolean;
  lastRead: LearningLastRead | null;
  days: readonly string[];
  streak: number;
  bestStreak: number;
  goal: LearningGoal | null;
  todayCount: number;
  list: readonly LearningListItem[];
};

type PersistedProgressState = {
  lastRead?: LearningLastRead | null;
  days?: string[];
  goal?: LearningGoal | null;
  progressDay?: string;
  progressKeys?: string[];
  list?: LearningListItem[];
};

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Local calendar day, not UTC. A reader in Los Angeles who reads at 5pm on
 * Monday should not have it counted as Tuesday.
 */
export function localDayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  // Rejects calendar-shaped but non-existent dates such as 2026-02-30.
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * Shift a day key by whole days. Built on local Date arithmetic rather than
 * adding 86_400_000ms so that a daylight-saving boundary still moves exactly
 * one calendar day.
 */
export function shiftDayKey(key: string, delta: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + delta);
  return localDayKey(date);
}

function sortedUniqueDays(days: readonly string[]): string[] {
  return Array.from(new Set(days.filter(isDayKey))).sort();
}

/**
 * Consecutive days ending today, or ending yesterday when today has no
 * reading yet. A streak should not look broken at 9am simply because the
 * reader has not opened the Surah yet that morning; it breaks once a whole
 * day has passed with nothing read.
 */
export function computeStreak(days: readonly string[], today: string = localDayKey()): number {
  const unique = new Set(sortedUniqueDays(days));
  if (!unique.size) return 0;

  let cursor = today;
  if (!unique.has(cursor)) {
    cursor = shiftDayKey(today, -1);
    if (!unique.has(cursor)) return 0;
  }

  let streak = 0;
  while (unique.has(cursor)) {
    streak += 1;
    cursor = shiftDayKey(cursor, -1);
  }
  return streak;
}

/** Longest run of consecutive days anywhere in the history. */
export function computeBestStreak(days: readonly string[]): number {
  const unique = sortedUniqueDays(days);
  if (!unique.length) return 0;

  let best = 1;
  let run = 1;
  for (let index = 1; index < unique.length; index += 1) {
    if (unique[index] === shiftDayKey(unique[index - 1], 1)) run += 1;
    else run = 1;
    if (run > best) best = run;
  }
  return best;
}

function isChapterId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 114;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1;
}

export function clampGoal(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DAILY_AYAH_GOAL;
  return Math.min(MAX_DAILY_AYAH_GOAL, Math.max(MIN_DAILY_AYAH_GOAL, Math.round(value)));
}

export function surahListItemId(chapterId: number): string {
  return `surah:${chapterId}`;
}

export function ayahListItemId(chapterId: number, verseNumber: number): string {
  return `ayah:${chapterId}:${verseNumber}`;
}

/**
 * Accept only well-formed persisted state. Anything unrecognised is dropped
 * rather than repaired, so a corrupted or hand-edited entry can never put the
 * reader into an impossible position.
 */
export function sanitizeProgressState(input: unknown): Required<PersistedProgressState> {
  const source = (input && typeof input === "object" ? input : {}) as PersistedProgressState;

  const lastRead = source.lastRead
    && isChapterId(source.lastRead.chapterId)
    && isPositiveInteger(source.lastRead.verseNumber)
    && isPositiveInteger(source.lastRead.pageNumber)
    ? {
        chapterId: source.lastRead.chapterId,
        verseNumber: source.lastRead.verseNumber,
        pageNumber: source.lastRead.pageNumber,
        updatedAt: Number.isFinite(source.lastRead.updatedAt) ? source.lastRead.updatedAt : 0,
      }
    : null;

  const days = sortedUniqueDays(Array.isArray(source.days) ? source.days : []).slice(-MAX_TRACKED_DAYS);

  const goal = source.goal && Number.isFinite(source.goal.ayahsPerDay)
    ? {
        ayahsPerDay: clampGoal(source.goal.ayahsPerDay),
        updatedAt: Number.isFinite(source.goal.updatedAt) ? source.goal.updatedAt : 0,
      }
    : null;

  const progressDay = isDayKey(source.progressDay) ? source.progressDay : "";

  const progressKeys = progressDay && Array.isArray(source.progressKeys)
    ? Array.from(new Set(source.progressKeys.filter((key): key is string => typeof key === "string"))).slice(0, MAX_DAILY_AYAH_KEYS)
    : [];

  const seenListIds = new Set<string>();
  const list = (Array.isArray(source.list) ? source.list : [])
    .filter((item) => Boolean(item && isChapterId(item.chapterId) && isPositiveInteger(item.pageNumber)))
    .map((item) => {
      /*
       * Entries saved before My List distinguished the two kinds have no
       * `kind` and an id of "<chapter>:<verse>". They were all single Ayahs,
       * so they migrate to "ayah" and are re-keyed rather than discarded.
       */
      const kind: LearningListKind = item.kind === "surah" ? "surah" : "ayah";
      const verseNumber = kind === "ayah" && isPositiveInteger(item.verseNumber) ? item.verseNumber : null;
      if (kind === "ayah" && verseNumber === null) return null;

      return {
        kind,
        id: kind === "surah" ? surahListItemId(item.chapterId) : ayahListItemId(item.chapterId, verseNumber as number),
        chapterId: item.chapterId,
        verseNumber,
        pageNumber: item.pageNumber,
        note: typeof item.note === "string" ? item.note.slice(0, 140) : "",
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : 0,
      } satisfies LearningListItem;
    })
    .filter((item): item is LearningListItem => item !== null)
    .filter((item) => {
      if (seenListIds.has(item.id)) return false;
      seenListIds.add(item.id);
      return true;
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_LIST_ITEMS);

  return { lastRead, days, goal, progressDay, progressKeys, list };
}

const EMPTY_SNAPSHOT: LearningProgressSnapshot = {
  hydrated: false,
  lastRead: null,
  days: [],
  streak: 0,
  bestStreak: 0,
  goal: null,
  todayCount: 0,
  list: [],
};

type InternalState = Required<PersistedProgressState>;

let state: InternalState = {
  lastRead: null,
  days: [],
  goal: null,
  progressDay: "",
  progressKeys: [],
  list: [],
};

let hydrated = false;
let snapshot: LearningProgressSnapshot = EMPTY_SNAPSHOT;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/**
 * Storage is resolved per call rather than captured once.
 *
 * Reading `localStorage` throws outright in some privacy modes, so the access
 * itself has to be guarded, not just the read. When it is unavailable the
 * store still works for the rest of the session and simply does not survive a
 * reload — the cards keep working rather than disappearing.
 */
function getStorage(): Storage | null {
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
}

function buildSnapshot(): LearningProgressSnapshot {
  const today = localDayKey();
  return {
    hydrated,
    lastRead: state.lastRead,
    days: state.days,
    streak: computeStreak(state.days, today),
    bestStreak: computeBestStreak(state.days),
    goal: state.goal,
    todayCount: state.progressDay === today ? state.progressKeys.length : 0,
    list: state.list,
  };
}

function notify() {
  snapshot = buildSnapshot();
  for (const listener of listeners) listener();
}

function persistNow() {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(LEARNING_PROGRESS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Progress is an enhancement. A full or blocked quota must never break
    // reading, so the failure is swallowed and the in-memory state stands.
  }
}

/**
 * Writes are debounced because reading progress is recorded as the reader
 * scrolls. The flush on pagehide/visibilitychange below is what guarantees
 * the last few seconds are not lost.
 */
function schedulePersist() {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, 400);
}

export function flushLearningProgress() {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistNow();
}

/**
 * Load saved progress. Safe to call more than once; only the first call reads.
 * Hydration succeeds even with no storage available, so the cards still work
 * for the session rather than staying permanently inert.
 */
export function hydrateLearningProgress() {
  if (hydrated) return;
  try {
    const raw = getStorage()?.getItem(LEARNING_PROGRESS_STORAGE_KEY);
    state = sanitizeProgressState(raw ? JSON.parse(raw) : {});
  } catch {
    state = sanitizeProgressState({});
  }
  hydrated = true;
  notify();
}

export function subscribeLearningProgress(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLearningProgressSnapshot(): LearningProgressSnapshot {
  return snapshot;
}

/** SSR and the first client render share this, so hydration cannot mismatch. */
export function getLearningProgressServerSnapshot(): LearningProgressSnapshot {
  return EMPTY_SNAPSHOT;
}

export type RecordReadingInput = {
  chapterId: number;
  verseNumber: number;
  pageNumber: number;
};

/**
 * Called by the reader as the reading position moves. Cheap and idempotent:
 * it only notifies subscribers when something a card actually displays has
 * changed, so ordinary scrolling within one Ayah costs nothing.
 */
export function recordLearningReading(input: RecordReadingInput) {
  if (!hydrated) return;
  if (!isChapterId(input.chapterId) || !isPositiveInteger(input.verseNumber) || !isPositiveInteger(input.pageNumber)) return;

  const today = localDayKey();
  const key = `${input.chapterId}:${input.verseNumber}`;
  let changed = false;

  if (
    !state.lastRead
    || state.lastRead.chapterId !== input.chapterId
    || state.lastRead.verseNumber !== input.verseNumber
    || state.lastRead.pageNumber !== input.pageNumber
  ) {
    state.lastRead = { ...input, updatedAt: Date.now() };
    changed = true;
  }

  if (!state.days.includes(today)) {
    state.days = [...state.days, today].slice(-MAX_TRACKED_DAYS);
    changed = true;
  }

  if (state.progressDay !== today) {
    // The calendar rolled over while the tab stayed open.
    state.progressDay = today;
    state.progressKeys = [];
    changed = true;
  }

  if (!state.progressKeys.includes(key) && state.progressKeys.length < MAX_DAILY_AYAH_KEYS) {
    state.progressKeys = [...state.progressKeys, key];
    changed = true;
  }

  if (!changed) return;
  schedulePersist();
  notify();
}

/**
 * Adopt an existing reader's saved positions the first time the cards appear,
 * so someone who has been reading since before this panel existed still sees
 * a populated Last Read card instead of an empty one.
 */
export function seedLearningLastRead(candidate: LearningLastRead) {
  if (!hydrated || state.lastRead) return;
  if (!isChapterId(candidate.chapterId) || !isPositiveInteger(candidate.verseNumber) || !isPositiveInteger(candidate.pageNumber)) return;
  state.lastRead = { ...candidate };
  schedulePersist();
  notify();
}

export function setLearningGoal(ayahsPerDay: number) {
  if (!hydrated) return;
  state.goal = { ayahsPerDay: clampGoal(ayahsPerDay), updatedAt: Date.now() };
  flushLearningProgress();
  notify();
}

export function clearLearningGoal() {
  if (!hydrated || !state.goal) return;
  state.goal = null;
  flushLearningProgress();
  notify();
}

function pushListItem(item: LearningListItem): boolean {
  if (state.list.some((existing) => existing.id === item.id)) return false;
  state.list = [item, ...state.list].slice(0, MAX_LIST_ITEMS);
  flushLearningProgress();
  notify();
  return true;
}

/**
 * Save a whole Surah — what the bookmark in the reader chrome does.
 * Returns false when it was already saved.
 */
export function addLearningListSurah(chapterId: number, pageNumber: number): boolean {
  if (!hydrated) return false;
  if (!isChapterId(chapterId) || !isPositiveInteger(pageNumber)) return false;

  return pushListItem({
    id: surahListItemId(chapterId),
    kind: "surah",
    chapterId,
    verseNumber: null,
    pageNumber,
    note: "",
    createdAt: Date.now(),
  });
}

/**
 * Save one Ayah — what tapping its medallion does.
 * Returns false when it was already saved.
 */
export function addLearningListAyah(chapterId: number, verseNumber: number, pageNumber: number): boolean {
  if (!hydrated) return false;
  if (!isChapterId(chapterId) || !isPositiveInteger(verseNumber) || !isPositiveInteger(pageNumber)) return false;

  return pushListItem({
    id: ayahListItemId(chapterId, verseNumber),
    kind: "ayah",
    chapterId,
    verseNumber,
    pageNumber,
    note: "",
    createdAt: Date.now(),
  });
}

export function removeLearningListItem(id: string) {
  if (!hydrated) return;
  const next = state.list.filter((item) => item.id !== id);
  if (next.length === state.list.length) return;
  state.list = next;
  flushLearningProgress();
  notify();
}

/** True when this whole Surah is saved. Ayahs saved inside it do not count. */
export function isSurahInLearningList(chapterId: number): boolean {
  return state.list.some((item) => item.kind === "surah" && item.chapterId === chapterId);
}

export function isAyahInLearningList(chapterId: number, verseNumber: number): boolean {
  return state.list.some(
    (item) => item.kind === "ayah" && item.chapterId === chapterId && item.verseNumber === verseNumber,
  );
}

/**
 * A stable string naming every saved Ayah, for the reader to subscribe to.
 *
 * The reader needs to mark saved medallions, but it must not re-render on
 * every reading-position update. Selecting this string instead of the
 * snapshot lets React compare by value and skip all the renders that do not
 * change which medallions are marked.
 */
export function learningListAyahSignature(): string {
  return state.list
    .filter((item) => item.kind === "ayah")
    .map((item) => `${item.chapterId}:${item.verseNumber}`)
    .sort()
    .join(",");
}

export function clearLearningList() {
  if (!hydrated || !state.list.length) return;
  state.list = [];
  flushLearningProgress();
  notify();
}

/** Most recent day keys first, for the streak strip. */
export function recentDayKeys(count: number, today: string = localDayKey()): string[] {
  return Array.from({ length: count }, (_, index) => shiftDayKey(today, -(count - 1 - index)));
}

/** Test seam: resets module state between unit tests. */
export function __resetLearningProgressForTests() {
  state = { lastRead: null, days: [], goal: null, progressDay: "", progressKeys: [], list: [] };
  hydrated = false;
  snapshot = EMPTY_SNAPSHOT;
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = null;
  listeners.clear();
}
