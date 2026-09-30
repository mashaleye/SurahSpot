"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  type ReactNode,
} from "react";

import { ModesMenu, LEARNING_BLOCKS_MODE_ID } from "@/components/ModesMenu";
import { LearningBookmarkButton, LearningHeroPanel } from "@/components/learning/LearningHeroPanel";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import type { ModeId } from "@/lib/game/modes";
import {
  addLearningListAyah,
  ayahListItemId,
  flushLearningProgress,
  hydrateLearningProgress,
  isAyahInLearningList,
  learningListAyahSignature,
  recordLearningReading,
  removeLearningListItem,
  seedLearningLastRead,
  subscribeLearningProgress,
} from "@/lib/learning/progress";
import {
  LEARNING_TOTAL_PAGES,
  formatNumberSpan,
  parseAyahRange,
  type LearningChapter,
  type LearningConfig,
  type LearningDisplayMode,
  type LearningLayoutMode,
  type LearningPageData,
  type LearningSurahData,
  type LearningVerse,
} from "@/lib/learning/types";

const BASMALA = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";
const STORAGE_KEY = "surahspot:learning-blocks:v1";
const LONG_PRESS_MS = 420;

/**
 * Hold duration for the Previous/Next controls to jump to the far end of the
 * Qur'an instead of stepping one Surah. Matches the hold that opens
 * memorization tracking, so the reader learns one press-and-hold feel.
 */
const SURAH_JUMP_HOLD_MS = 520;
const MIN_GESTURE_BLOCK = 5;
const MAX_GESTURE_BLOCK = 10;

/**
 * How many Surahs Scroll view keeps mounted at once.
 *
 * Scroll view is a continuous vertical stack: reaching the end of a Surah
 * brings in the next, and scrolling back up brings in the previous. Without a
 * cap a long session would accumulate thousands of Ayah nodes — Al-Baqarah
 * alone is 286 — so the window slides, dropping the far end.
 */
const MAX_SCROLL_PANELS = 5;

/**
 * How long Scroll view leaves a Surah alone after it failed to load.
 *
 * Without this, a Surah that cannot be fetched is retried on every scroll
 * frame — a single failure turns into a request storm for as long as the
 * reader stays near that edge. Long enough to stop the storm, short enough
 * that a passing network blip recovers on its own.
 */
const SCROLL_RETRY_AFTER_MS = 30_000;

/**
 * useLayoutEffect warns during server rendering, where it cannot run. The
 * scroll compensation below has to happen before paint, so it uses the layout
 * effect in the browser and a no-op on the server.
 */
const useBrowserLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// A restore is only "corrected" while the reader has not deliberately moved.
// Mobile browsers settle scroll by a pixel or two on their own after a
// programmatic jump, so an exact comparison would read as user intent.
const RESTORE_SETTLE_TOLERANCE = 4;

type HiddenBlock = {
  id: string;
  chapterId: number;
  start: number;
  end: number;
  createdAt: number;
};

type MemorizationStatus = "in-progress" | "memorized";

type MemorizedSurahRecord = {
  chapterId: number;
  status: MemorizationStatus;
  updatedAt: number;
};

type MemorizedBlockRecord = {
  id: string;
  chapterId: number;
  start: number;
  end: number;
  status: MemorizationStatus;
  updatedAt: number;
};

type ReadingPosition = {
  verseNumber: number;
  pageNumber: number;
  offsetFromAnchor: number;
  progressWithinVerse?: number;
  updatedAt: number;
};

type SequenceBlockData = {
  chapter: LearningChapter;
  start: number;
  end: number;
  verses: LearningVerse[];
  translationMeta: LearningPageData["translationMeta"];
};

type PersistedReaderState = {
  layout?: LearningLayoutMode;
  display?: LearningDisplayMode;
  language?: string;
  page?: number;
  chapter?: number;
  fontScale?: number;
  hiddenSurahs?: number[];
  hiddenVerses?: string[];
  hiddenBlocks?: HiddenBlock[];
  memorizedSurahs?: MemorizedSurahRecord[];
  memorizedBlocks?: MemorizedBlockRecord[];
  readingPositions?: Record<string, ReadingPosition>;
};

type GestureState = {
  timer: number | null;
  active: boolean;
  startChapterId: number;
  startVerse: number;
  startKey: string;
};

type NavigatorMode = "surah" | "verse" | "juz" | "page";
type DrawerPanel = "controls" | "range" | "sequence" | "memorized-surahs" | "memorized-blocks" | "memorization-progress";

function clampPage(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(LEARNING_TOTAL_PAGES, Math.max(1, Math.floor(value)));
}

/*
 * visualViewport describes the area actually available for reading. On mobile
 * that shrinks and grows as the URL bar collapses, and innerHeight does not
 * always follow it; using one source for both capture and restore keeps the
 * reading anchor from drifting between the two. Desktop simply falls back.
 */
function readerViewportHeight() {
  if (typeof window === "undefined") return 0;
  return window.visualViewport?.height ?? window.innerHeight;
}

/*
 * "auto" means "whatever scroll-behavior CSS says", so a global
 * `scroll-behavior: smooth` silently turns every restore into an animation
 * that is still running when capture resumes — and the in-flight scroll gets
 * saved as the reader's position. "instant" is unconditional.
 */
const INSTANT_SCROLL = "instant" as ScrollBehavior;

function verseKey(chapterId: number, verseNumber: number) {
  return `${chapterId}:${verseNumber}`;
}

function shuffled<T>(items: readonly T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function toArabicIndicDigits(value: number) {
  return String(value).replace(/\d/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)] ?? digit);
}

function capitalizeWords(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The Ayah medallion. Besides numbering the Ayah it is the control that saves
 * it to My List, so it is a real button rather than decorative text.
 *
 * Pointer events stop here: the surrounding Ayah owns a press-and-hold gesture
 * for hiding a block, and a tap on its body reveals a hidden Ayah. Neither
 * should fire when the person is aiming at the medallion.
 */
/**
 * A Previous/Next Surah control that steps by one on a tap and jumps to the
 * far end of the Qur'an on a press-and-hold.
 *
 * The hold is a shortcut, not the only route: holding is hard to discover and
 * impossible from a keyboard, so the Navigate panel still reaches any Surah
 * directly. The hint lives in the title and the accessible description.
 */
function SurahStepButton({
  className,
  label,
  holdLabel,
  disabled = false,
  onStep,
  onJump,
  children,
}: {
  className: string;
  label: string;
  holdLabel: string;
  disabled?: boolean;
  onStep: () => void;
  onJump: () => void;
  children: ReactNode;
}) {
  const holdTimerRef = useRef<number | null>(null);
  const heldRef = useRef(false);
  const originRef = useRef<{ x: number; y: number } | null>(null);

  const cancelHold = useCallback(() => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    originRef.current = null;
  }, []);

  useEffect(() => cancelHold, [cancelHold]);

  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      aria-label={label}
      aria-description={`${label}. Press and hold to ${holdLabel.toLowerCase()}.`}
      title={`${label} — hold to ${holdLabel.toLowerCase()}`}
      onPointerDown={(event) => {
        if (disabled) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        heldRef.current = false;
        originRef.current = { x: event.clientX, y: event.clientY };
        holdTimerRef.current = window.setTimeout(() => {
          holdTimerRef.current = null;
          heldRef.current = true;
          onJump();
          if (typeof navigator !== "undefined") navigator.vibrate?.(18);
        }, SURAH_JUMP_HOLD_MS);
      }}
      onPointerMove={(event) => {
        // A press that turns into a drag or a scroll is not a hold.
        const origin = originRef.current;
        if (!origin || !holdTimerRef.current) return;
        if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 12) cancelHold();
      }}
      onPointerUp={cancelHold}
      onPointerCancel={() => { cancelHold(); heldRef.current = false; }}
      onPointerLeave={cancelHold}
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => {
        // The hold already navigated; the click that follows it is ignored.
        if (heldRef.current) {
          heldRef.current = false;
          return;
        }
        onStep();
      }}
    >
      {children}
    </button>
  );
}

function AyahMarker({
  number,
  saved,
  onToggleSave,
}: {
  number: number;
  saved: boolean;
  onToggleSave: () => void;
}) {
  return (
    <button
      type="button"
      className={`learning-ayah-number ${saved ? "is-saved" : ""}`}
      aria-pressed={saved}
      aria-label={saved ? `Ayah ${number}, saved. Remove from My List` : `Ayah ${number}. Save to My List`}
      title={saved ? "Saved to My List" : "Save this Ayah to My List"}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        onToggleSave();
      }}
    >
      {toArabicIndicDigits(number)}
    </button>
  );
}

function ToggleButton({
  checked,
  onChange,
  children,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`learning-toggle ${checked ? "is-on" : ""}`}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="learning-toggle-track" aria-hidden="true"><i /></span>
      <span>{children}</span>
    </button>
  );
}

export function LearningBlocksReader() {
  const [config, setConfig] = useState<LearningConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [pageError, setPageError] = useState("");
  const [surahs, setSurahs] = useState<Record<number, LearningSurahData>>({});
  const [loadingSurahs, setLoadingSurahs] = useState<Set<number>>(() => new Set());
  const surahLoadingRef = useRef(new Set<string>());

  const [layout, setLayout] = useState<LearningLayoutMode>("book");
  const [display, setDisplay] = useState<LearningDisplayMode>("arabic");
  const [language, setLanguage] = useState("english");
  const languageRef = useRef("english");
  const [currentPage, setCurrentPage] = useState(1);
  const [currentChapterId, setCurrentChapterId] = useState(1);
  const [pageJump, setPageJump] = useState("1");
  const [activePage, setActivePage] = useState(1);

  /**
   * The Surahs mounted in Scroll view, in ascending order. Explicit
   * navigation resets this to a single Surah; scrolling grows it.
   */
  const [scrollChapters, setScrollChapters] = useState<number[]>([1]);
  const [hydrated, setHydrated] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [navigatorMode, setNavigatorMode] = useState<NavigatorMode>("page");
  const [navigatorChapterId, setNavigatorChapterId] = useState(1);
  const [navigatorVerse, setNavigatorVerse] = useState("1");
  const [navigatorJuz, setNavigatorJuz] = useState("1");
  const [navigatorSearch, setNavigatorSearch] = useState("");
  const [verseSurahSearch, setVerseSurahSearch] = useState("");
  const [verseAyahSearch, setVerseAyahSearch] = useState("");
  const [verseSurahPickerOpen, setVerseSurahPickerOpen] = useState(false);
  const [verseAyahPickerOpen, setVerseAyahPickerOpen] = useState(false);
  const [juzPickerOpen, setJuzPickerOpen] = useState(false);
  const [pagePickerOpen, setPagePickerOpen] = useState(false);
  const [rangeSurahPickerOpen, setRangeSurahPickerOpen] = useState(false);
  const [juzSearch, setJuzSearch] = useState("");
  const [pageSearch, setPageSearch] = useState("");
  const [rangeSurahSearch, setRangeSurahSearch] = useState("");
  const [navigatorLoading, setNavigatorLoading] = useState(false);
  const [navigatorError, setNavigatorError] = useState("");
  const [navigationTargetKey, setNavigationTargetKey] = useState<string | null>(null);
  const [memorizedBlockFlash, setMemorizedBlockFlash] = useState<{ chapterId: number; start: number; end: number } | null>(null);
  const [openReaderHeaderKey, setOpenReaderHeaderKey] = useState<string | null>(null);
  const navigationTargetTimerRef = useRef<number | null>(null);
  const memorizedBlockFlashTimerRef = useRef<number | null>(null);
  const verseSurahPickerRef = useRef<HTMLDivElement | null>(null);
  const verseAyahPickerRef = useRef<HTMLDivElement | null>(null);
  const juzPickerRef = useRef<HTMLDivElement | null>(null);
  const pagePickerRef = useRef<HTMLDivElement | null>(null);
  const rangeSurahPickerRef = useRef<HTMLDivElement | null>(null);
  const drawerSwipeRef = useRef<{ x: number; y: number } | null>(null);
  const [drawerPanel, setDrawerPanel] = useState<DrawerPanel>("controls");
  const [drawerDragX, setDrawerDragX] = useState(0);
  const [drawerDragging, setDrawerDragging] = useState(false);
  const [drawerCarouselHeight, setDrawerCarouselHeight] = useState<number | null>(null);
  const controlsPanelRef = useRef<HTMLDivElement | null>(null);
  const rangePanelRef = useRef<HTMLDivElement | null>(null);
  const sequencePanelRef = useRef<HTMLDivElement | null>(null);
  const memorizedSurahsPanelRef = useRef<HTMLDivElement | null>(null);
  const memorizedBlocksPanelRef = useRef<HTMLDivElement | null>(null);
  const memorizationProgressPanelRef = useRef<HTMLDivElement | null>(null);
  const memorizationLongPressTimerRef = useRef<number | null>(null);
  const memorizationPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressHeroClickRef = useRef(false);
  const [memorizationMode, setMemorizationMode] = useState(false);

  const [memorizedSurahs, setMemorizedSurahs] = useState<MemorizedSurahRecord[]>([]);
  const [memorizedBlocks, setMemorizedBlocks] = useState<MemorizedBlockRecord[]>([]);
  const [memorizedSurahPickerOpen, setMemorizedSurahPickerOpen] = useState(false);
  const [memorizedSurahSearch, setMemorizedSurahSearch] = useState("");
  const [memorizedSurahSelection, setMemorizedSurahSelection] = useState<Set<number>>(() => new Set());
  const [memorizedSurahStatus, setMemorizedSurahStatus] = useState<MemorizationStatus>("in-progress");
  const memorizedSurahPickerRef = useRef<HTMLDivElement | null>(null);

  const [memorizedBlockChapterId, setMemorizedBlockChapterId] = useState(1);
  const [memorizedBlockRange, setMemorizedBlockRange] = useState("");
  const [memorizedBlockStatus, setMemorizedBlockStatus] = useState<MemorizationStatus>("in-progress");
  const [memorizedBlockMessage, setMemorizedBlockMessage] = useState("");
  const [memorizedBlockSurahPickerOpen, setMemorizedBlockSurahPickerOpen] = useState(false);
  const [memorizedBlockSurahSearch, setMemorizedBlockSurahSearch] = useState("");
  const memorizedBlockSurahPickerRef = useRef<HTMLDivElement | null>(null);

  const [hideAyahs, setHideAyahs] = useState(false);
  const [sequenceEnabled, setSequenceEnabled] = useState(false);
  const [hiddenSurahs, setHiddenSurahs] = useState<Set<number>>(() => new Set());
  const [hiddenVerses, setHiddenVerses] = useState<Set<string>>(() => new Set());
  const [hiddenBlocks, setHiddenBlocks] = useState<HiddenBlock[]>([]);
  const [rangeChapterId, setRangeChapterId] = useState(1);
  const [rangeInput, setRangeInput] = useState("");
  const [rangeMessage, setRangeMessage] = useState("");

  const [gesturePreview, setGesturePreview] = useState<Set<string>>(() => new Set());
  const [gestureToast, setGestureToast] = useState("");
  const toastTimerRef = useRef<number | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const suppressClickKeyRef = useRef<string | null>(null);
  const milestoneRef = useRef(0);

  const [activeBlockId, setActiveBlockId] = useState<string>("");
  const [sequenceData, setSequenceData] = useState<SequenceBlockData | null>(null);
  const [sequenceLoading, setSequenceLoading] = useState(false);
  const [sequenceError, setSequenceError] = useState("");
  const [sequenceSlots, setSequenceSlots] = useState<Array<string | null>>([]);
  const [sequenceLocked, setSequenceLocked] = useState<boolean[]>([]);
  const [sequenceBankOrder, setSequenceBankOrder] = useState<string[]>([]);
  const [sequenceMessage, setSequenceMessage] = useState("");

  const bookSwipeRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const bookSwipeTimerRef = useRef<number | null>(null);
  const bookCarouselRef = useRef<HTMLDivElement | null>(null);
  const bookStageRef = useRef<HTMLDivElement | null>(null);
  const bookSwipeProgressRef = useRef(0);
  const bookSwipeDirectionRef = useRef<"next" | "previous" | null>(null);
  const bookFlipTargetRef = useRef<number | null>(null);
  const bookCommitFrameRef = useRef<number | null>(null);
  const [bookFlipDirection, setBookFlipDirection] = useState<"next" | "previous" | null>(null);
  const [bookFlipPhase, setBookFlipPhase] = useState<"idle" | "drag" | "slide" | "snap" | "commit">("idle");
  const [bookFlipTargetChapterId, setBookFlipTargetChapterId] = useState<number | null>(null);
  const [bookSwipeDragging, setBookSwipeDragging] = useState(false);
  const [bookSwipeNavigating, setBookSwipeNavigating] = useState(false);

  /*
   * Per-Surah reading memory deliberately lives in refs instead of React state.
   * Scroll events can fire dozens of times per second; keeping the hot path out
   * of state prevents long Surahs from re-rendering while the user reads.
   */
  const readingPositionsRef = useRef<Record<string, ReadingPosition>>({});
  const pendingReadingRestoreRef = useRef<{ chapterId: number } | null>(null);
  const readingPositionPersistTimerRef = useRef<number | null>(null);
  const readingPositionCaptureFrameRef = useRef<number | null>(null);
  const readingRestoreTimerRef = useRef<number | null>(null);
  const restoringReadingPositionRef = useRef(false);
  const initialReadingRestoreDoneRef = useRef(false);
  const bookGesturePositionCapturedRef = useRef(false);

  /*
   * Where the reader was left standing by the last restore. Any later
   * correction (fonts settling, layout reflow) is only allowed to run while
   * the page is still sitting there; once the reader scrolls, corrections
   * would be yanking the page out from under them.
   */
  const restoreScrollYRef = useRef<number | null>(null);

  /*
   * Restoration is requested explicitly rather than inferred from an
   * incidental dependency change. Re-opening the Surah you are already in
   * changes no other dependency, so without this the effect would never run.
   */
  const [readingRestoreToken, setReadingRestoreToken] = useState(0);
  const requestReadingRestore = useCallback((chapterId: number) => {
    restoringReadingPositionRef.current = true;
    pendingReadingRestoreRef.current = { chapterId };
    setReadingRestoreToken((token) => token + 1);
  }, []);

  const scrollTopSentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollBottomSentinelRef = useRef<HTMLDivElement | null>(null);

  /**
   * Set immediately before a change that adds or removes content *above* the
   * viewport. The layout effect below reads it and shifts the scroll position
   * by however much the document grew or shrank, so the words under the
   * reader's eyes do not move.
   */
  const scrollAnchorRef = useRef<{ height: number } | null>(null);

  /** Guards against two loads being kicked off for the same neighbour. */
  const scrollExtendingRef = useRef(false);

  /** When each Surah last failed to load, so failures are not retried hotly. */
  const scrollLoadFailedAtRef = useRef(new Map<number, number>());

  /** Whether each end of the stack is currently near the viewport. */
  const scrollTopEdgeVisibleRef = useRef(false);
  const scrollBottomEdgeVisibleRef = useRef(false);

  /**
   * Whether the reader has scrolled upward since this stack was built. Growing
   * upward waits for that, so arriving at a Surah never fetches the one before
   * it unasked.
   */
  const scrollWentUpRef = useRef(false);

  const headerSuppressTimerRef = useRef<number | null>(null);

  /**
   * Mark the next moment of scrolling as the reader's own, not the person's.
   *
   * The global site header hides when you scroll down through a page. Without
   * this, restoring a saved reading position on load counts as a downward
   * scroll and the navigation bar disappears before the person has touched
   * anything. The flag lives on <html> so SiteHeader can honour it without
   * knowing this reader exists, and it clears itself so a missed cleanup
   * cannot disable the behaviour for the rest of the session.
   */
  const suppressHeaderAutoHide = useCallback((durationMs = 700) => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-suppress-header-autohide", "");
    if (headerSuppressTimerRef.current) window.clearTimeout(headerSuppressTimerRef.current);
    headerSuppressTimerRef.current = window.setTimeout(() => {
      headerSuppressTimerRef.current = null;
      document.documentElement.removeAttribute("data-suppress-header-autohide");
    }, durationMs);
  }, []);

  /*
   * Which Ayahs are saved, as a comparable string.
   *
   * Subscribing to the progress snapshot here would re-render the reader on
   * every reading-position update — that is, on every scroll frame, across
   * hundreds of Ayah nodes. Selecting a signature instead means React only
   * re-renders when the saved set actually changes, and one subscription
   * serves every medallion rather than each of them holding its own.
   */
  const savedAyahSignature = useSyncExternalStore(
    subscribeLearningProgress,
    learningListAyahSignature,
    () => "",
  );

  const savedAyahs = useMemo(
    () => new Set(savedAyahSignature ? savedAyahSignature.split(",") : []),
    [savedAyahSignature],
  );

  const showToast = useCallback((message: string) => {
    setGestureToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setGestureToast(""), 1100);
  }, []);

  const toggleAyahSaved = useCallback((verse: LearningVerse) => {
    if (isAyahInLearningList(verse.chapterId, verse.verseNumber)) {
      removeLearningListItem(ayahListItemId(verse.chapterId, verse.verseNumber));
      showToast(`Ayah ${verse.verseNumber} removed from My List`);
      return;
    }

    const added = addLearningListAyah(verse.chapterId, verse.verseNumber, verse.pageNumber);
    showToast(added ? `Ayah ${verse.verseNumber} saved to My List` : "My List is full");
  }, [showToast]);

  const persistReadingPositions = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const current = raw ? JSON.parse(raw) as PersistedReaderState : {};
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...current,
        readingPositions: readingPositionsRef.current,
      }));
    } catch {
      // Reading memory is progressive enhancement; storage failures should not
      // interrupt the reader.
    }
  }, []);

  const scheduleReadingPositionPersist = useCallback(() => {
    if (readingPositionPersistTimerRef.current) window.clearTimeout(readingPositionPersistTimerRef.current);
    readingPositionPersistTimerRef.current = window.setTimeout(() => {
      readingPositionPersistTimerRef.current = null;
      persistReadingPositions();
    }, 260);
  }, [persistReadingPositions]);

  const getReadingAnchorY = useCallback(() => {
    const height = readerViewportHeight();
    const chrome = document.getElementById("learning-reader-start");
    const stableHeader = chrome?.querySelector<HTMLElement>(".learning-surah-title-hero");
    const rect = stableHeader?.getBoundingClientRect() ?? chrome?.getBoundingClientRect();
    if (rect && rect.bottom > 0 && rect.top < height) {
      // Use the collapsed reader chrome as the anchor even if the Dynamic
      // Island drawer is expanded. That keeps the saved reading position
      // independent from temporary control-panel height.
      return Math.min(height * 0.48, Math.max(92, rect.bottom + 18));
    }
    return Math.min(176, Math.max(96, height * 0.2));
  }, []);

  const captureReadingPosition = useCallback((chapterId = currentChapterId) => {
    if (!hydrated || restoringReadingPositionRef.current) return;
    const surface = document.getElementById(`learning-surah-${chapterId}`);
    if (!surface) return;

    const verses = Array.from(surface.querySelectorAll<HTMLElement>("[data-learning-verse-key]"));
    if (!verses.length) return;

    const anchorY = getReadingAnchorY();
    let best: { element: HTMLElement; rect: DOMRect; distance: number } | null = null;

    /*
     * Do not require the chosen Ayah to be inside the viewport. In Scroll view,
     * the Previous/Next Surah controls live after the reading surface, so the
     * final Ayah can already be just above the viewport when the user leaves.
     * Choosing the closest rendered Ayah preserves that end-of-Surah position
     * instead of silently dropping the save.
     */
    for (const element of verses) {
      const rect = element.getBoundingClientRect();
      if (rect.height <= 0) continue;
      const distance = rect.top <= anchorY && rect.bottom >= anchorY
        ? 0
        : Math.min(Math.abs(rect.top - anchorY), Math.abs(rect.bottom - anchorY));
      if (!best || distance < best.distance) best = { element, rect, distance };
      if (distance === 0) break;
    }

    if (!best) return;
    const verseNumber = Number(best.element.dataset.verseNumber);
    const pageNumber = Number(best.element.dataset.learningPageNumber);
    if (!Number.isInteger(verseNumber) || !Number.isInteger(pageNumber)) return;

    const offsetFromAnchor = anchorY - best.rect.top;
    const progressWithinVerse = best.rect.height > 0
      ? Math.min(1, Math.max(0, offsetFromAnchor / best.rect.height))
      : 0;

    readingPositionsRef.current[String(chapterId)] = {
      verseNumber,
      pageNumber,
      offsetFromAnchor,
      progressWithinVerse,
      updatedAt: Date.now(),
    };
    scheduleReadingPositionPersist();

    /*
     * Feed the hero cards. This is deliberately a store call rather than a
     * setState: the store only notifies its own subscriber when a displayed
     * value changes, so scrolling a long Surah updates the Last Read card
     * without re-rendering the hundreds of Ayah nodes in this component.
     */
    recordLearningReading({ chapterId, verseNumber, pageNumber });
  }, [currentChapterId, getReadingAnchorY, hydrated, scheduleReadingPositionPersist]);

  const restoreReadingPosition = useCallback((chapterId: number) => {
    const surface = document.getElementById(`learning-surah-${chapterId}`);
    const readerStart = document.getElementById("learning-reader-start");
    if (!surface || !readerStart) return false;

    const position = readingPositionsRef.current[String(chapterId)];

    // Every path below moves the document, so none of them should read as the
    // person scrolling away from the top of the page.
    suppressHeaderAutoHide();

    if (!position) {
      // A Surah that has never been visited always begins at its true start.
      const firstVerse = surface.querySelector<HTMLElement>("[data-learning-verse-key]");
      const firstPage = Number(firstVerse?.dataset.learningPageNumber);
      if (Number.isInteger(firstPage)) {
        const page = clampPage(firstPage);
        setCurrentPage(page);
        setActivePage(page);
        setPageJump(String(page));
      }
      readerStart.scrollIntoView({ block: "start", behavior: INSTANT_SCROLL });
      return true;
    }

    const target = surface.querySelector<HTMLElement>(
      `[data-learning-verse-key="${verseKey(chapterId, position.verseNumber)}"]`,
    );

    if (!target) return false;

    const page = clampPage(position.pageNumber);
    setCurrentPage(page);
    setActivePage(page);
    setPageJump(String(page));

    const anchorY = getReadingAnchorY();

    const rect = target.getBoundingClientRect();
    if (rect.height <= 0) return false;

    // A proportional position survives the large line-wrap difference between
    // desktop and mobile. Older saved entries fall back to their pixel offset.
    const restoredOffset = Number.isFinite(position.progressWithinVerse)
      ? Math.min(1, Math.max(0, position.progressWithinVerse as number)) * rect.height
      : position.offsetFromAnchor;

    const nextScrollTop = Math.max(0, window.scrollY + rect.top + restoredOffset - anchorY);
    window.scrollTo({ top: nextScrollTop, behavior: INSTANT_SCROLL });
    return true;
  }, [getReadingAnchorY, suppressHeaderAutoHide]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (
        verseSurahPickerOpen
        && verseSurahPickerRef.current
        && !verseSurahPickerRef.current.contains(target)
      ) {
        setVerseSurahPickerOpen(false);
      }

      if (
        verseAyahPickerOpen
        && verseAyahPickerRef.current
        && !verseAyahPickerRef.current.contains(target)
      ) {
        setVerseAyahPickerOpen(false);
      }

      if (juzPickerOpen && juzPickerRef.current && !juzPickerRef.current.contains(target)) {
        setJuzPickerOpen(false);
      }

      if (pagePickerOpen && pagePickerRef.current && !pagePickerRef.current.contains(target)) {
        setPagePickerOpen(false);
      }

      if (
        rangeSurahPickerOpen
        && rangeSurahPickerRef.current
        && !rangeSurahPickerRef.current.contains(target)
      ) {
        setRangeSurahPickerOpen(false);
      }

      if (
        memorizedSurahPickerOpen
        && memorizedSurahPickerRef.current
        && !memorizedSurahPickerRef.current.contains(target)
      ) {
        setMemorizedSurahPickerOpen(false);
      }

      if (
        memorizedBlockSurahPickerOpen
        && memorizedBlockSurahPickerRef.current
        && !memorizedBlockSurahPickerRef.current.contains(target)
      ) {
        setMemorizedBlockSurahPickerOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [juzPickerOpen, memorizedBlockSurahPickerOpen, memorizedSurahPickerOpen, pagePickerOpen, rangeSurahPickerOpen, verseAyahPickerOpen, verseSurahPickerOpen]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (navigationTargetTimerRef.current) window.clearTimeout(navigationTargetTimerRef.current);
      if (memorizedBlockFlashTimerRef.current) window.clearTimeout(memorizedBlockFlashTimerRef.current);
      if (gestureRef.current?.timer) window.clearTimeout(gestureRef.current.timer);
      if (memorizationLongPressTimerRef.current) window.clearTimeout(memorizationLongPressTimerRef.current);
      if (readingPositionPersistTimerRef.current) window.clearTimeout(readingPositionPersistTimerRef.current);
      if (readingPositionCaptureFrameRef.current) window.cancelAnimationFrame(readingPositionCaptureFrameRef.current);
      if (readingRestoreTimerRef.current) window.clearTimeout(readingRestoreTimerRef.current);
      if (headerSuppressTimerRef.current) window.clearTimeout(headerSuppressTimerRef.current);
      document.documentElement.removeAttribute("data-suppress-header-autohide");
      document.documentElement.style.removeProperty("overflow-anchor");
      persistReadingPositions();
      flushLearningProgress();
    };
  }, [persistReadingPositions]);

  useEffect(() => {
    /*
     * A Surah named in the URL, as `?surah=2`, and optionally an Ayah in it,
     * as `?surah=2&ayah=152`.
     *
     * Read before the stored state so a link can override it. Someone
     * arriving from a link to Al-Baqarah means to land in Al-Baqarah, not
     * wherever they happened to stop reading last week — but their saved
     * position *within* that Surah is still theirs, so the restore below
     * still applies. An Ayah is different: like the navigator's Verse jump it
     * is an explicit destination, so it wins over the saved position.
     *
     * Both are consumed and then removed from the address. A reminder opens
     * the installed app at this URL, and the app can be reloaded from it
     * hours later; without this the reload would jump back to that Ayah
     * instead of resuming where the reader actually got to.
     */
    let requestedChapterId: number | null = null;
    let requestedVerseNumber: number | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      const requested = Number(params.get("surah"));
      if (Number.isInteger(requested) && requested >= 1 && requested <= 114) {
        requestedChapterId = requested;
        const ayah = Number(params.get("ayah"));
        if (Number.isInteger(ayah) && ayah >= 1) requestedVerseNumber = ayah;
      }
      if (params.has("surah") || params.has("ayah")) {
        params.delete("surah");
        params.delete("ayah");
        const rest = params.toString();
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`,
        );
      }
    } catch {
      // No URL to read from; carry on with stored state.
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as PersistedReaderState;
        if (parsed.layout === "book" || parsed.layout === "scroll") setLayout(parsed.layout);
        if (["arabic", "verse-translation", "translation"].includes(parsed.display ?? "")) {
          setDisplay(parsed.display as LearningDisplayMode);
        }
        if (typeof parsed.language === "string" && parsed.language) setLanguage(parsed.language);
        if (typeof parsed.page === "number") {
          const page = clampPage(parsed.page);
          setCurrentPage(page);
          setPageJump(String(page));
          setActivePage(page);
        }
        if (typeof parsed.chapter === "number" && Number.isInteger(parsed.chapter) && parsed.chapter >= 1 && parsed.chapter <= 114) {
          setCurrentChapterId(parsed.chapter);
          setScrollChapters([parsed.chapter]);
          setNavigatorChapterId(parsed.chapter);
          setRangeChapterId(parsed.chapter);
        }
        if (typeof parsed.fontScale === "number" && Number.isFinite(parsed.fontScale)) {
          setFontScale(Math.min(1.4, Math.max(0.8, parsed.fontScale)));
        }
        if (Array.isArray(parsed.hiddenSurahs)) {
          setHiddenSurahs(new Set(parsed.hiddenSurahs.map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 114)));
        }
        if (Array.isArray(parsed.hiddenVerses)) setHiddenVerses(new Set(parsed.hiddenVerses.filter((key): key is string => typeof key === "string")));
        if (Array.isArray(parsed.hiddenBlocks)) {
          setHiddenBlocks(parsed.hiddenBlocks.filter((block) =>
            block && Number.isInteger(block.chapterId) && Number.isInteger(block.start) && Number.isInteger(block.end),
          ));
        }
        if (Array.isArray(parsed.memorizedSurahs)) {
          setMemorizedSurahs(parsed.memorizedSurahs.filter((record) =>
            record
            && Number.isInteger(record.chapterId)
            && record.chapterId >= 1
            && record.chapterId <= 114
            && (record.status === "in-progress" || record.status === "memorized"),
          ));
        }
        if (Array.isArray(parsed.memorizedBlocks)) {
          setMemorizedBlocks(parsed.memorizedBlocks.filter((record) =>
            record
            && Number.isInteger(record.chapterId)
            && Number.isInteger(record.start)
            && Number.isInteger(record.end)
            && record.start >= 1
            && record.end >= record.start
            && (record.status === "in-progress" || record.status === "memorized"),
          ));
        }
        if (parsed.readingPositions && typeof parsed.readingPositions === "object") {
          const restored: Record<string, ReadingPosition> = {};
          for (const [chapterKey, position] of Object.entries(parsed.readingPositions)) {
            const chapterId = Number(chapterKey);
            if (
              Number.isInteger(chapterId)
              && chapterId >= 1
              && chapterId <= 114
              && position
              && Number.isInteger(position.verseNumber)
              && Number.isInteger(position.pageNumber)
              && Number.isFinite(position.offsetFromAnchor)
            ) {
              restored[String(chapterId)] = {
                verseNumber: position.verseNumber,
                pageNumber: clampPage(position.pageNumber),
                offsetFromAnchor: position.offsetFromAnchor,
                progressWithinVerse: Number.isFinite(position.progressWithinVerse)
                  ? Math.min(1, Math.max(0, position.progressWithinVerse as number))
                  : undefined,
                updatedAt: Number.isFinite(position.updatedAt) ? position.updatedAt : 0,
              };
            }
          }
          readingPositionsRef.current = restored;
        }
      }
    } catch {
      // A malformed local preference should never block the reader.
    } finally {
      if (requestedChapterId !== null) {
        setCurrentChapterId(requestedChapterId);
        setScrollChapters([requestedChapterId]);
        setNavigatorChapterId(requestedChapterId);
        setRangeChapterId(requestedChapterId);

        if (requestedVerseNumber !== null) {
          // Skip the initial restore, exactly as navigateSurah does for an
          // explicit target, and let the navigation-target effect scroll to
          // the Ayah once the Surah has rendered.
          initialReadingRestoreDoneRef.current = true;
          pendingReadingRestoreRef.current = null;
          restoringReadingPositionRef.current = false;
          setNavigationTargetKey(verseKey(requestedChapterId, requestedVerseNumber));
        }
      }

      hydrateLearningProgress();

      /*
       * Adopt the newest existing reading position the first time the hero
       * cards run, so a reader who was already using Learning Blocks before
       * these cards existed sees their real place rather than an empty card.
       * seedLearningLastRead ignores this once a stored last-read exists.
       */
      const newest = Object.entries(readingPositionsRef.current)
        .map(([chapterKey, position]) => ({ chapterId: Number(chapterKey), position }))
        .filter((entry) => Number.isInteger(entry.chapterId))
        .sort((a, b) => b.position.updatedAt - a.position.updatedAt)[0];

      if (newest) {
        seedLearningLastRead({
          chapterId: newest.chapterId,
          verseNumber: newest.position.verseNumber,
          pageNumber: newest.position.pageNumber,
          updatedAt: newest.position.updatedAt,
        });
      }

      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const value: PersistedReaderState = {
      layout,
      display,
      language,
      page: currentPage,
      chapter: currentChapterId,
      fontScale,
      hiddenSurahs: Array.from(hiddenSurahs),
      hiddenVerses: Array.from(hiddenVerses),
      hiddenBlocks,
      memorizedSurahs,
      memorizedBlocks,
      readingPositions: readingPositionsRef.current,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }, [hydrated, layout, display, language, currentPage, currentChapterId, fontScale, hiddenSurahs, hiddenVerses, hiddenBlocks, memorizedSurahs, memorizedBlocks]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/quran/learning/config", { cache: "no-cache" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load the Qur’an reader.");
        if (cancelled) return;
        setConfig(data);
        const validLanguage = data.languages?.some((item: { id: string; available: boolean }) => item.id === language && item.available);
        if (!validLanguage) {
          const fallback = data.languages?.find((item: { available: boolean }) => item.available)?.id ?? "english";
          setLanguage(fallback);
        }
        if (!data.chapters?.some((chapter: LearningChapter) => chapter.id === rangeChapterId)) setRangeChapterId(1);
      } catch (error) {
        if (!cancelled) setConfigError(error instanceof Error ? error.message : "Could not load the reader.");
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    if (!hideAyahs) setDrawerPanel("controls");
  }, [hideAyahs]);

  /**
   * `quiet` suppresses the error banner. Scroll view prefetches neighbouring
   * Surahs in the background; if one cannot be fetched the stack simply stops
   * growing in that direction, which is not something to interrupt the reader
   * with — unlike a Surah they actually asked for.
   */
  const loadSurah = useCallback(async (chapterId: number, force = false, quiet = false) => {
    const chapter = Math.min(114, Math.max(1, Math.floor(chapterId)));
    const key = `${chapter}:${language}`;
    if (!force && surahs[chapter]?.translationMeta.language === language) return surahs[chapter];
    if (surahLoadingRef.current.has(key)) return null;

    /*
     * Background loads back off after a failure. Both the neighbour prefetch
     * and Scroll view's stack ask for Surahs repeatedly as the reader moves,
     * so without this one unavailable Surah is re-requested on every scroll
     * frame. A Surah the reader explicitly asked for is never held back.
     */
    if (quiet) {
      const failedAt = scrollLoadFailedAtRef.current.get(chapter);
      if (failedAt !== undefined) {
        if (Date.now() - failedAt < SCROLL_RETRY_AFTER_MS) return null;
        scrollLoadFailedAtRef.current.delete(chapter);
      }
    }

    surahLoadingRef.current.add(key);
    setLoadingSurahs((previous) => new Set(previous).add(chapter));
    setPageError("");

    try {
      const response = await fetch(`/api/quran/learning/surah?chapter=${chapter}&language=${encodeURIComponent(language)}`, {
        /*
         * Revalidate rather than refetch. The route returns an ETag over the
         * exact payload, so a Surah already in the browser cache costs a 304
         * of a couple of hundred bytes instead of up to 83KB — the single
         * biggest saving available on mobile data.
         */
        cache: "no-cache",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Could not load Surah ${chapter}.`);
      if (languageRef.current !== language) return null;
      scrollLoadFailedAtRef.current.delete(chapter);
      setSurahs((previous) => ({ ...previous, [chapter]: data }));
      return data as LearningSurahData;
    } catch (error) {
      scrollLoadFailedAtRef.current.set(chapter, Date.now());
      if (!quiet) setPageError(error instanceof Error ? error.message : `Could not load Surah ${chapter}.`);
      return null;
    } finally {
      surahLoadingRef.current.delete(key);
      setLoadingSurahs((previous) => {
        const next = new Set(previous);
        next.delete(chapter);
        return next;
      });
    }
  }, [language, surahs]);

  /*
   * Refetch when the translation changes.
   *
   * The mount run is skipped deliberately. On mount this effect would fire
   * alongside hydration and reset the Surah stack using the initial chapter
   * rather than the restored one, throwing away the Surah the reader was
   * last on. The neighbour-loading effect below already covers the first
   * load, so there is nothing for the mount run to do.
   */
  const loadedLanguageRef = useRef(language);
  useEffect(() => {
    if (loadedLanguageRef.current === language) return;
    loadedLanguageRef.current = language;

    setSurahs({});
    surahLoadingRef.current.clear();
    scrollLoadFailedAtRef.current.clear();
    // Every mounted Surah has to be refetched, so the stack restarts rather
    // than mixing translations.
    setScrollChapters([currentChapterId]);
    void loadSurah(currentChapterId, true);
  }, [language]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadSurah(currentChapterId);
    // Neighbours are speculative, so they load quietly: a failure must not
    // raise an error banner, and it must back off rather than being retried
    // every time the reader crosses into another Surah.
    if (currentChapterId > 1) void loadSurah(currentChapterId - 1, false, true);
    if (currentChapterId < 114) void loadSurah(currentChapterId + 1, false, true);
  }, [currentChapterId, loadSurah]);

  const navigateSurah = useCallback((
    chapterId: number,
    targetPage?: number,
    scrollReader = true,
    sourceAlreadyCaptured = false,
  ) => {
    const nextChapter = Math.min(114, Math.max(1, Math.floor(chapterId)));
    const hasExplicitTarget = Number.isInteger(targetPage);

    if (nextChapter !== currentChapterId && !sourceAlreadyCaptured) {
      // Save synchronously before React replaces the current Surah DOM.
      captureReadingPosition(currentChapterId);
      persistReadingPositions();
    }

    if (!hasExplicitTarget) {
      // Start suppressing scroll capture before the new Surah mounts. Otherwise
      // the old window.scrollY can be accidentally recorded as the *new*
      // Surah's reading position before restoration runs.
      requestReadingRestore(nextChapter);
    } else {
      pendingReadingRestoreRef.current = null;
      restoringReadingPositionRef.current = false;
    }

    setCurrentChapterId(nextChapter);
    // Scroll view is a continuous stack, so an explicit jump restarts it at
    // the chosen Surah rather than scrolling through everything between.
    setScrollChapters([nextChapter]);
    scrollWentUpRef.current = false;
    setNavigatorChapterId(nextChapter);
    setRangeChapterId(nextChapter);
    setNavigatorVerse("1");
    setOpenReaderHeaderKey(null);
    if (hasExplicitTarget) {
      const nextPage = clampPage(targetPage as number);
      setCurrentPage(nextPage);
      setActivePage(nextPage);
      setPageJump(String(nextPage));
    }
    if (hasExplicitTarget && scrollReader) {
      // A smooth scroll keeps moving after the call returns, so the flag is
      // held long enough to cover the whole animation.
      suppressHeaderAutoHide(900);
      requestAnimationFrame(() => {
        document.getElementById("learning-reader-start")?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    }
  }, [captureReadingPosition, currentChapterId, persistReadingPositions, requestReadingRestore, suppressHeaderAutoHide]);

  /**
   * Open an exact Ayah from the hero cards (Last Read, My List).
   *
   * scrollReader is false on purpose: navigateSurah would scroll to the top of
   * the reader, and the navigation-target effect below then scrolls to the
   * Ayah itself. Letting both run would animate twice.
   */
  const openLearningPosition = useCallback((chapterId: number, verseNumber: number | null, pageNumber: number) => {
    if (verseNumber === null) {
      // A whole-Surah bookmark names the Surah, not a spot in it, so it opens
      // the Surah and resumes where reading stopped — the same as choosing it
      // from the navigator.
      navigateSurah(chapterId);
      return;
    }
    setNavigationTargetKey(verseKey(chapterId, verseNumber));
    navigateSurah(chapterId, pageNumber, false);
  }, [navigateSurah]);

  const setBookCarouselProgress = useCallback((progress: number, direction = bookSwipeDirectionRef.current) => {
    const shell = bookCarouselRef.current;
    const clamped = Math.max(-1, Math.min(1, progress));
    bookSwipeProgressRef.current = clamped;
    if (!shell) return;

    const base = direction === "next" ? 1 : direction === "previous" ? -1 : 0;
    shell.style.setProperty("--book-stage-x", `${clamped * 100}%`);
    shell.style.setProperty("--book-underlay-x", `${(base + clamped) * 100}%`);
  }, []);

  useEffect(() => () => {
    if (bookSwipeTimerRef.current) window.clearTimeout(bookSwipeTimerRef.current);
    if (bookCommitFrameRef.current) window.cancelAnimationFrame(bookCommitFrameRef.current);
  }, []);

  const resetBookCarousel = useCallback(() => {
    if (bookCommitFrameRef.current) {
      window.cancelAnimationFrame(bookCommitFrameRef.current);
      bookCommitFrameRef.current = null;
    }
    bookSwipeDirectionRef.current = null;
    bookFlipTargetRef.current = null;
    bookGesturePositionCapturedRef.current = false;
    setBookCarouselProgress(0, null);
    setBookSwipeDragging(false);
    setBookFlipDirection(null);
    setBookFlipTargetChapterId(null);
    setBookFlipPhase("idle");
    setBookSwipeNavigating(false);
  }, [setBookCarouselProgress]);

  const commitBookSurahTurn = useCallback((destination?: number) => {
    const target = destination ?? bookFlipTargetRef.current;
    if (!target) return;

    // Clear the target ref immediately so duplicate transitionend events cannot
    // commit the same turn twice.
    bookFlipTargetRef.current = null;

    if (bookSwipeTimerRef.current) {
      window.clearTimeout(bookSwipeTimerRef.current);
      bookSwipeTimerRef.current = null;
    }

    if (bookCommitFrameRef.current) {
      window.cancelAnimationFrame(bookCommitFrameRef.current);
      bookCommitFrameRef.current = null;
    }

    // The important part of the hand-off: keep the carousel at its completed
    // endpoint while the active Surah changes underneath it. The incoming
    // underlay is already sitting at x=0, so the user never sees the outgoing
    // page spring back to the center.
    setBookFlipPhase("commit");
    setBookSwipeDragging(false);

    bookCommitFrameRef.current = window.requestAnimationFrame(() => {
      navigateSurah(target, undefined, false, true);

      // Wait one more painted frame so React can render the new active Surah
      // while the identical underlay remains visible. Then reset transforms
      // with transitions disabled. This removes the one-frame snap that was
      // especially noticeable in mobile Safari.
      bookCommitFrameRef.current = window.requestAnimationFrame(() => {
        resetBookCarousel();
        bookCommitFrameRef.current = null;
      });
    });
  }, [navigateSurah, resetBookCarousel]);

  const finishBookSurahTurn = useCallback(() => {
    if (bookFlipPhase !== "slide") return;
    commitBookSurahTurn();
  }, [bookFlipPhase, commitBookSurahTurn]);

  const turnBookSurah = useCallback(async (direction: "next" | "previous") => {
    if (layout !== "book" || bookSwipeNavigating) return;

    const destination = direction === "next" ? currentChapterId + 1 : currentChapterId - 1;
    if (destination < 1 || destination > 114) return;

    // A swipe can move the current surface almost completely offscreen before
    // the turn commits, so the source position must be captured *before* the
    // horizontal animation. Touch swipes capture on touch-start; buttons and
    // keyboard navigation capture here.
    if (!bookGesturePositionCapturedRef.current) {
      captureReadingPosition(currentChapterId);
      persistReadingPositions();
      bookGesturePositionCapturedRef.current = true;
    }

    // Never animate toward an empty panel. Adjacent Surahs are normally
    // prefetched, but a slower connection can still outrun the prefetch.
    const target = surahs[destination] ?? await loadSurah(destination);
    if (!target) return;

    bookSwipeDirectionRef.current = direction;
    bookFlipTargetRef.current = destination;

    setBookSwipeDragging(false);
    setBookSwipeNavigating(true);
    setBookFlipDirection(direction);
    setBookFlipTargetChapterId(destination);

    // Preserve the exact finger position if this turn started from a swipe.
    // For button/keyboard navigation the progress is simply zero.
    setBookCarouselProgress(bookSwipeProgressRef.current, direction);
    setBookFlipPhase("slide");

    if (bookSwipeTimerRef.current) window.clearTimeout(bookSwipeTimerRef.current);

    // Mount the neighboring Surah at exactly +/-100%, allow it one paint, and
    // then animate both flat layers in lockstep. No React state is updated per
    // animation frame, which keeps long Arabic Surahs smooth on mobile.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setBookCarouselProgress(direction === "next" ? -1 : 1, direction);
      });
    });

    // transitionend is authoritative. This is only a safety net for browsers
    // that suppress transition events after tab/background interruptions.
    bookSwipeTimerRef.current = window.setTimeout(() => {
      commitBookSurahTurn(destination);
      bookSwipeTimerRef.current = null;
    }, 900);
  }, [bookSwipeNavigating, captureReadingPosition, commitBookSurahTurn, currentChapterId, layout, loadSurah, persistReadingPositions, setBookCarouselProgress, surahs]);

  const snapBookCarouselBack = useCallback((direction = bookSwipeDirectionRef.current) => {
    setBookSwipeDragging(false);
    setBookFlipPhase("snap");

    if (bookSwipeTimerRef.current) window.clearTimeout(bookSwipeTimerRef.current);

    // Let the snap transition class paint before changing the transform. With
    // direct CSS-variable updates this ordering matters; otherwise Safari can
    // apply x=0 while the drag class still has transitions disabled.
    window.requestAnimationFrame(() => {
      setBookCarouselProgress(0, direction);
    });

    bookSwipeTimerRef.current = window.setTimeout(() => {
      resetBookCarousel();
      bookSwipeTimerRef.current = null;
    }, 320);
  }, [resetBookCarousel, setBookCarouselProgress]);

  const beginBookSwipe = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (layout !== "book" || bookSwipeNavigating) return;
    const touch = event.touches[0];
    if (!touch) return;

    // Capture while the active Surah is still at x=0. Waiting until touch-end
    // can measure the horizontally translated layer and save the wrong Ayah.
    captureReadingPosition(currentChapterId);
    persistReadingPositions();
    bookGesturePositionCapturedRef.current = true;

    bookSwipeRef.current = { x: touch.clientX, y: touch.clientY, time: performance.now() };
    bookSwipeDirectionRef.current = null;
    bookFlipTargetRef.current = null;
    setBookCarouselProgress(0, null);
    setBookSwipeDragging(true);
    setBookFlipPhase("drag");
    setBookFlipDirection(null);
    setBookFlipTargetChapterId(null);
  };

  const moveBookSwipe = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (layout !== "book" || !bookSwipeRef.current || bookSwipeNavigating) return;
    if (gestureRef.current?.active) {
      bookSwipeRef.current = null;
      resetBookCarousel();
      return;
    }

    const touch = event.touches[0];
    if (!touch) return;

    const start = bookSwipeRef.current;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    // Let ordinary vertical reading win until the gesture is clearly
    // horizontal. Once a direction is established, latch it for the rest of
    // the gesture so tiny finger wobble cannot teleport the neighboring page
    // from one side of the carousel to the other.
    if (!bookSwipeDirectionRef.current) {
      if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy) * 1.15) return;

      const direction: "next" | "previous" = dx < 0 ? "next" : "previous";
      const destination = direction === "next" ? currentChapterId + 1 : currentChapterId - 1;

      bookSwipeDirectionRef.current = direction;
      setBookFlipDirection(direction);

      if (destination >= 1 && destination <= 114) {
        bookFlipTargetRef.current = destination;
        setBookFlipTargetChapterId(destination);
        void loadSurah(destination);
      } else {
        bookFlipTargetRef.current = null;
        setBookFlipTargetChapterId(null);
      }
    }

    if (event.cancelable) event.preventDefault();

    const direction = bookSwipeDirectionRef.current;
    if (!direction) return;

    const width = Math.max(1, event.currentTarget.clientWidth);
    const atEdge = !bookFlipTargetRef.current;
    const resistance = atEdge ? 0.18 : 1;
    const maxProgress = atEdge ? 0.075 : 0.94;
    let rawProgress = (dx * resistance) / width;

    // Once the direction is latched, reversing the finger only brings the page
    // back toward zero; it never crosses over and exposes the opposite side.
    rawProgress = direction === "next"
      ? Math.min(0, rawProgress)
      : Math.max(0, rawProgress);

    const progress = Math.max(-maxProgress, Math.min(maxProgress, rawProgress));
    setBookCarouselProgress(progress, direction);
  };

  const endBookSwipe = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (!bookSwipeRef.current) {
      resetBookCarousel();
      return;
    }

    const start = bookSwipeRef.current;
    const touch = event.changedTouches[0];
    bookSwipeRef.current = null;
    setBookSwipeDragging(false);

    const direction = bookSwipeDirectionRef.current;

    if (!touch || gestureRef.current?.active || !direction) {
      snapBookCarouselBack(direction);
      return;
    }

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const elapsed = Math.max(1, performance.now() - start.time);
    const velocity = Math.abs(dx) / elapsed;
    const width = Math.max(1, event.currentTarget.clientWidth);
    const distanceThreshold = Math.min(96, Math.max(48, width * 0.13));
    const horizontalIntent = Math.abs(dx) > Math.abs(dy) * 1.15;
    const movedInLatchedDirection = direction === "next" ? dx < 0 : dx > 0;
    const shouldNavigate = horizontalIntent
      && movedInLatchedDirection
      && (Math.abs(dx) >= distanceThreshold || (velocity >= 0.48 && Math.abs(dx) >= 28));

    if (!shouldNavigate || !bookFlipTargetRef.current) {
      snapBookCarouselBack(direction);
      return;
    }

    void turnBookSurah(direction);
  };

  const cancelBookSwipe = () => {
    bookSwipeRef.current = null;
    snapBookCarouselBack(bookSwipeDirectionRef.current);
  };

  const navigateByMode = async (
    mode: NavigatorMode,
    options?: { chapterId?: number; verseNumber?: number; juzNumber?: number; pageNumber?: number },
  ) => {
    setNavigatorLoading(true);
    setNavigatorError("");
    try {
      const params = new URLSearchParams({ type: mode });
      if (mode === "surah" || mode === "verse") {
        params.set("chapter", String(options?.chapterId ?? navigatorChapterId));
      }
      if (mode === "verse") params.set("verse", String(options?.verseNumber ?? Number(navigatorVerse)));
      if (mode === "juz") params.set("juz", String(options?.juzNumber ?? Number(navigatorJuz)));
      if (mode === "page") params.set("page", String(options?.pageNumber ?? Number(pageJump)));

      const response = await fetch(`/api/quran/learning/navigate?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not navigate there.");
      if (!Number.isInteger(data.pageNumber)) throw new Error("That location could not be resolved to a page.");

      if (typeof data.verseKey === "string" && mode !== "surah") setNavigationTargetKey(data.verseKey);
      else setNavigationTargetKey(null);
      if (!Number.isInteger(data.chapterId)) throw new Error("That location could not be resolved to a Surah.");
      // Choosing a Surah is a revisit and should honor that Surah's saved reading
      // position. Verse/Juz/Page navigation is an explicit destination and wins.
      navigateSurah(data.chapterId, mode === "surah" ? undefined : data.pageNumber);
    } catch (error) {
      setNavigatorError(error instanceof Error ? error.message : "Could not navigate there.");
    } finally {
      setNavigatorLoading(false);
    }
  };

  useEffect(() => {
    if (!navigationTargetKey || !surahs[currentChapterId]) return;
    const target = document.querySelector<HTMLElement>(`[data-learning-verse-key="${navigationTargetKey}"]`);
    if (!target) return;
    suppressHeaderAutoHide(900);
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    if (navigationTargetTimerRef.current) window.clearTimeout(navigationTargetTimerRef.current);
    navigationTargetTimerRef.current = window.setTimeout(() => setNavigationTargetKey(null), 1800);
  }, [navigationTargetKey, suppressHeaderAutoHide, surahs, currentChapterId]);

  useEffect(() => {
    if (!memorizedBlockFlash || memorizedBlockFlash.chapterId !== currentChapterId || !surahs[currentChapterId]) return;
    const firstKey = verseKey(memorizedBlockFlash.chapterId, memorizedBlockFlash.start);
    const target = document.querySelector<HTMLElement>(`[data-learning-verse-key="${firstKey}"]`);
    if (!target) return;

    suppressHeaderAutoHide(900);
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    });

    if (memorizedBlockFlashTimerRef.current) window.clearTimeout(memorizedBlockFlashTimerRef.current);
    memorizedBlockFlashTimerRef.current = window.setTimeout(() => {
      setMemorizedBlockFlash(null);
      memorizedBlockFlashTimerRef.current = null;
    }, 1800);
  }, [memorizedBlockFlash, suppressHeaderAutoHide, surahs, currentChapterId]);

  useEffect(() => {
    if (!hydrated || !surahs[currentChapterId]) return;

    // Initial load follows the same rule as navigation: a previously visited
    // Surah restores its saved position; a new Surah starts at the beginning.
    if (!initialReadingRestoreDoneRef.current) {
      initialReadingRestoreDoneRef.current = true;
      if (!pendingReadingRestoreRef.current) {
        pendingReadingRestoreRef.current = { chapterId: currentChapterId };
        restoringReadingPositionRef.current = true;
      }
    }

    const pending = pendingReadingRestoreRef.current;

    /*
     * Nothing is waiting to be restored, so capture must not stay suppressed.
     * This effect re-runs on every neighbouring-Surah prefetch, and without
     * this release a re-run that lands mid-restore would leave the suppression
     * flag stuck on for the rest of the session — after which no position is
     * ever saved and every Surah looks unvisited.
     */
    if (!pending) {
      restoringReadingPositionRef.current = false;
      return;
    }

    if (pending.chapterId !== currentChapterId) return;

    // During a Book carousel hand-off the active layer is still horizontally
    // translated. Wait for the carousel reset so the restored vertical
    // position is measured against the stable, final Surah DOM.
    if (layout === "book" && bookSwipeNavigating) return;

    restoringReadingPositionRef.current = true;

    /*
     * Chrome and Android scroll anchoring adjusts scrollTop on its own when
     * content above the viewport changes height — exactly what Arabic webfont
     * swap does. That fights the restore, so it is switched off for the
     * duration and handed straight back.
     */
    const rootStyle = document.documentElement.style;
    const previousOverflowAnchor = rootStyle.getPropertyValue("overflow-anchor");
    rootStyle.setProperty("overflow-anchor", "none");

    const releaseSuppression = () => {
      restoringReadingPositionRef.current = false;
      if (previousOverflowAnchor) rootStyle.setProperty("overflow-anchor", previousOverflowAnchor);
      else rootStyle.removeProperty("overflow-anchor");
    };

    let cancelled = false;
    let placed = false;
    let correctionAborted = false;
    let firstFrame = 0;
    let secondFrame = 0;
    let attemptsRemaining = 8;

    // A correction is only safe while the reader is still sitting exactly where
    // the restore put them. A wheel, a flick or a keypress makes it their page.
    const readerHasNotMoved = () => restoreScrollYRef.current === null
      || Math.abs(window.scrollY - restoreScrollYRef.current) <= RESTORE_SETTLE_TOLERANCE;

    const applyCorrection = () => {
      if (!readerHasNotMoved()) return;
      restoringReadingPositionRef.current = true;
      restoreReadingPosition(currentChapterId);
      restoreScrollYRef.current = window.scrollY;
      window.requestAnimationFrame(releaseSuppression);
    };

    const finishRestore = () => {
      if (cancelled) return;
      placed = true;
      restoreScrollYRef.current = window.scrollY;

      if (pendingReadingRestoreRef.current?.chapterId === currentChapterId) {
        pendingReadingRestoreRef.current = null;
      }

      readingRestoreTimerRef.current = window.setTimeout(() => {
        readingRestoreTimerRef.current = null;
        if (correctionAborted) return;

        // One final correction after fonts/layout settle keeps the same Ayah
        // aligned on desktop and mobile without continuously fighting scroll.
        if (readerHasNotMoved()) {
          restoreReadingPosition(currentChapterId);
          restoreScrollYRef.current = window.scrollY;
        }

        window.requestAnimationFrame(() => {
          if (!correctionAborted) releaseSuppression();
        });
      }, 90);

      /*
       * Mobile loads the Arabic webfont late and reflows the whole surface
       * long after that 90ms window. Correcting once more when fonts are ready
       * is what stops the restored Ayah drifting up the page on a phone.
       */
      if (typeof document !== "undefined" && document.fonts && document.fonts.status !== "loaded") {
        void document.fonts.ready.then(() => {
          if (correctionAborted) return;
          applyCorrection();
        });
      }
    };

    const attemptRestore = () => {
      if (cancelled) return;
      if (restoreReadingPosition(currentChapterId)) {
        finishRestore();
        return;
      }

      attemptsRemaining -= 1;
      if (attemptsRemaining <= 0) {
        if (pendingReadingRestoreRef.current?.chapterId === currentChapterId) {
          pendingReadingRestoreRef.current = null;
        }
        releaseSuppression();
        return;
      }

      readingRestoreTimerRef.current = window.setTimeout(() => {
        readingRestoreTimerRef.current = null;
        attemptRestore();
      }, 45);
    };

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(attemptRestore);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);

      /*
       * A prefetch resolving mid-restore re-runs this effect. If the reader has
       * already been placed, let the settle correction stand and leave the
       * timer alone; only an unfinished restore is torn down here.
       */
      if (!placed) {
        correctionAborted = true;
        if (readingRestoreTimerRef.current) {
          window.clearTimeout(readingRestoreTimerRef.current);
          readingRestoreTimerRef.current = null;
        }
      }

      if (placed || !pendingReadingRestoreRef.current) releaseSuppression();
    };
  }, [bookSwipeNavigating, currentChapterId, display, fontScale, hydrated, layout, readingRestoreToken, restoreReadingPosition, surahs]);

  useEffect(() => {
    if (!hydrated || !surahs[currentChapterId]) return;

    const queueCapture = () => {
      if (restoringReadingPositionRef.current || bookSwipeNavigating) return;
      if (readingPositionCaptureFrameRef.current) return;
      readingPositionCaptureFrameRef.current = window.requestAnimationFrame(() => {
        readingPositionCaptureFrameRef.current = null;
        captureReadingPosition(currentChapterId);
      });
    };

    const flush = () => {
      captureReadingPosition(currentChapterId);
      persistReadingPositions();
      // The progress store debounces its own writes, so the last few seconds
      // of reading would otherwise be lost when the tab is backgrounded.
      flushLearningProgress();
    };

    const handleVisibilityChange = () => {
      // Switching apps on mobile is the common way to leave the reader, and it
      // does not reliably produce pagehide. Desktop tab-switching lands here
      // too, which is equally worth saving.
      if (document.visibilityState === "hidden") flush();
    };

    window.addEventListener("scroll", queueCapture, { passive: true });
    window.addEventListener("resize", queueCapture, { passive: true });
    window.visualViewport?.addEventListener("resize", queueCapture);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("scroll", queueCapture);
      window.removeEventListener("resize", queueCapture);
      window.visualViewport?.removeEventListener("resize", queueCapture);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (readingPositionCaptureFrameRef.current) {
        window.cancelAnimationFrame(readingPositionCaptureFrameRef.current);
        readingPositionCaptureFrameRef.current = null;
      }
      captureReadingPosition(currentChapterId);
    };
  }, [bookSwipeNavigating, captureReadingPosition, currentChapterId, hydrated, persistReadingPositions, surahs]);

  useEffect(() => {
    if (layout !== "book") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, select, textarea, button, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") turnBookSurah("previous");
      if (event.key === "ArrowRight") turnBookSurah("next");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [layout, currentChapterId, turnBookSurah]);

  const changeLayout = (nextLayout: LearningLayoutMode) => {
    if (nextLayout === layout) return;
    captureReadingPosition(currentChapterId);
    persistReadingPositions();
    requestReadingRestore(currentChapterId);
    setLayout(nextLayout);
    // Book view reads one Surah at a time, so it adopts whichever page the
    // reader was last looking at. Scroll view keeps the page it already has,
    // and restarts its stack at the Surah on screen.
    if (nextLayout === "book") setCurrentPage(activePage);
    else setScrollChapters([currentChapterId]);
  };

  /** Press-and-hold target for the Previous control: the first Surah. */
  const jumpToQuranStart = useCallback(() => {
    if (currentChapterId === 1) return;
    navigateSurah(1);
    showToast("Beginning of the Qur\u2019an");
  }, [currentChapterId, navigateSurah, showToast]);

  /** Press-and-hold target for the Next control: the last Surah. */
  const jumpToQuranEnd = useCallback(() => {
    if (currentChapterId === 114) return;
    navigateSurah(114);
    showToast("End of the Qur\u2019an");
  }, [currentChapterId, navigateSurah, showToast]);

  const gameModeSelect = (modeId: ModeId, variantId?: string) => {
    const params = new URLSearchParams({ challenge: "1", mode: modeId });
    if (variantId) params.set("variant", variantId);
    window.location.assign(`/?${params.toString()}`);
  };

  const toggleSurahHidden = (chapterId: number) => {
    setHiddenSurahs((previous) => {
      const next = new Set(previous);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const toggleVerseHidden = (verse: LearningVerse) => {
    const key = verse.verseKey;
    setHiddenVerses((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setRangeChapterId(verse.chapterId);
  };

  const addHiddenBlock = useCallback((chapterId: number, start: number, end: number) => {
    const startVerse = Math.min(start, end);
    const endVerse = Math.max(start, end);
    const keys = Array.from({ length: endVerse - startVerse + 1 }, (_, index) => verseKey(chapterId, startVerse + index));
    setHiddenVerses((previous) => new Set([...previous, ...keys]));
    const id = `${chapterId}:${startVerse}-${endVerse}:${Date.now()}`;
    const block: HiddenBlock = { id, chapterId, start: startVerse, end: endVerse, createdAt: Date.now() };
    setHiddenBlocks((previous) => [...previous.filter((item) => !(item.chapterId === chapterId && item.start === startVerse && item.end === endVerse)), block]);
    setActiveBlockId(id);
  }, []);

  const eligibleBlocks = useMemo(() => hiddenBlocks.filter((block) => {
    const count = block.end - block.start + 1;
    if (count < MIN_GESTURE_BLOCK || count > MAX_GESTURE_BLOCK) return false;
    for (let verse = block.start; verse <= block.end; verse += 1) {
      if (!hiddenVerses.has(verseKey(block.chapterId, verse))) return false;
    }
    return true;
  }).sort((a, b) => b.createdAt - a.createdAt), [hiddenBlocks, hiddenVerses]);

  useEffect(() => {
    if (drawerPanel === "range" && !hideAyahs) {
      setDrawerPanel("controls");
      return;
    }
    if (drawerPanel === "sequence" && !sequenceEnabled) {
      setDrawerPanel(hideAyahs ? "range" : "controls");
    }
  }, [drawerPanel, hideAyahs, sequenceEnabled]);

  useEffect(() => {
    if (openReaderHeaderKey !== "reader-chrome") {
      setDrawerCarouselHeight(null);
      return;
    }

    const activePanel = drawerPanel === "range"
      ? rangePanelRef.current
      : drawerPanel === "sequence"
        ? sequencePanelRef.current
        : drawerPanel === "memorized-surahs"
          ? memorizedSurahsPanelRef.current
          : drawerPanel === "memorized-blocks"
            ? memorizedBlocksPanelRef.current
            : drawerPanel === "memorization-progress"
              ? memorizationProgressPanelRef.current
              : controlsPanelRef.current;

    if (!activePanel) return;

    const updateHeight = () => {
      const nextHeight = Math.ceil(activePanel.getBoundingClientRect().height);
      if (nextHeight > 0) setDrawerCarouselHeight(nextHeight);
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(activePanel);
    return () => observer.disconnect();
  }, [drawerPanel, openReaderHeaderKey, hideAyahs, sequenceEnabled, memorizationMode, memorizedSurahs, memorizedBlocks, memorizedSurahPickerOpen, memorizedBlockSurahPickerOpen]);

  useEffect(() => {
    if (!sequenceEnabled) return;
    if (!eligibleBlocks.length) {
      setActiveBlockId("");
      setSequenceData(null);
      return;
    }
    if (!eligibleBlocks.some((block) => block.id === activeBlockId)) {
      setActiveBlockId(eligibleBlocks[0].id);
    }
  }, [sequenceEnabled, eligibleBlocks, activeBlockId]);

  const activeBlock = eligibleBlocks.find((block) => block.id === activeBlockId) ?? null;

  useEffect(() => {
    if (!sequenceEnabled || !activeBlock) {
      setSequenceData(null);
      setSequenceSlots([]);
      setSequenceLocked([]);
      setSequenceBankOrder([]);
      setSequenceMessage("");
      return;
    }
    let cancelled = false;
    setSequenceLoading(true);
    setSequenceError("");
    (async () => {
      try {
        const response = await fetch(
          `/api/quran/learning/block?chapter=${activeBlock.chapterId}&start=${activeBlock.start}&end=${activeBlock.end}&language=${encodeURIComponent(language)}`,
          { cache: "no-store" },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load that hidden block.");
        if (cancelled) return;
        setSequenceData(data);
        const ids = (data.verses as LearningVerse[]).map((verse) => verse.verseKey);
        setSequenceSlots(Array(ids.length).fill(null));
        setSequenceLocked(Array(ids.length).fill(false));
        setSequenceBankOrder(shuffled(ids));
        setSequenceMessage("");
      } catch (error) {
        if (!cancelled) setSequenceError(error instanceof Error ? error.message : "Could not load that block.");
      } finally {
        if (!cancelled) setSequenceLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sequenceEnabled, activeBlockId, activeBlock, language]);

  const sequenceVerseByKey = useMemo(() => new Map(sequenceData?.verses.map((verse) => [verse.verseKey, verse]) ?? []), [sequenceData]);
  const usedSequenceIds = useMemo(() => new Set(sequenceSlots.filter((value): value is string => Boolean(value))), [sequenceSlots]);
  const availableSequenceIds = sequenceBankOrder.filter((id) => !usedSequenceIds.has(id));

  const placeSequenceChoice = (id: string, requestedSlot?: number) => {
    setSequenceMessage("");
    setSequenceSlots((previous) => {
      const next = [...previous];
      const existing = next.indexOf(id);
      const target = requestedSlot ?? next.findIndex((item, index) => item === null && !sequenceLocked[index]);
      if (target < 0 || target >= next.length || sequenceLocked[target]) return previous;
      if (existing === target) return previous;
      if (existing >= 0 && !sequenceLocked[existing]) {
        const displaced = next[target];
        next[target] = id;
        next[existing] = displaced ?? null;
      } else {
        next[target] = id;
      }
      return next;
    });
  };

  const checkSequence = () => {
    if (!sequenceData || sequenceSlots.some((item) => !item)) return;
    const expected = sequenceData.verses.map((verse) => verse.verseKey);
    const correct = expected.map((id, index) => sequenceSlots[index] === id);
    if (correct.every(Boolean)) {
      setSequenceLocked(correct);
      setSequenceMessage("Nice — the whole block is in order.");
      return;
    }
    setSequenceSlots((previous) => previous.map((id, index) => correct[index] ? id : null));
    setSequenceLocked((previous) => previous.map((locked, index) => locked || correct[index]));
    const lockedCount = correct.filter(Boolean).length;
    setSequenceMessage(lockedCount ? `${lockedCount} position${lockedCount === 1 ? " is" : "s are"} correct. Keep going.` : "Not quite yet. Try the order again.");
  };

  const resetSequence = () => {
    if (!sequenceData) return;
    const ids = sequenceData.verses.map((verse) => verse.verseKey);
    setSequenceSlots(Array(ids.length).fill(null));
    setSequenceLocked(Array(ids.length).fill(false));
    setSequenceBankOrder(shuffled(ids));
    setSequenceMessage("");
  };

  const applyRange = () => {
    const chapter = config?.chapters.find((item) => item.id === rangeChapterId);
    if (!chapter) return;
    const parsed = parseAyahRange(rangeInput, chapter.versesCount);
    if (!parsed) {
      setRangeMessage(`Use a range inside ${chapter.nameSimple}, such as 1-6, 7-12, or 5,10.`);
      return;
    }
    const keys = Array.from({ length: parsed.end - parsed.start + 1 }, (_, index) => verseKey(chapter.id, parsed.start + index));
    const allHidden = keys.every((key) => hiddenVerses.has(key));
    if (allHidden) {
      setHiddenVerses((previous) => {
        const next = new Set(previous);
        for (const key of keys) next.delete(key);
        return next;
      });
      setHiddenBlocks((previous) => previous.filter((block) => !(block.chapterId === chapter.id && block.start === parsed.start && block.end === parsed.end)));
      setRangeMessage(`Revealed ${chapter.nameSimple} ${parsed.start}–${parsed.end}.`);
    } else {
      addHiddenBlock(chapter.id, parsed.start, parsed.end);
      const count = parsed.end - parsed.start + 1;
      setRangeMessage(
        count >= MIN_GESTURE_BLOCK && count <= MAX_GESTURE_BLOCK
          ? `Hidden ${chapter.nameSimple} ${parsed.start}–${parsed.end}. It is ready for Sequence.`
          : `Hidden ${chapter.nameSimple} ${parsed.start}–${parsed.end}.`,
      );
    }
  };

  const beginGesture = (event: ReactPointerEvent, verse: LearningVerse) => {
    if (!hideAyahs) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (gestureRef.current?.timer) window.clearTimeout(gestureRef.current.timer);
    const state: GestureState = {
      timer: null,
      active: false,
      startChapterId: verse.chapterId,
      startVerse: verse.verseNumber,
      startKey: verse.verseKey,
    };
    state.timer = window.setTimeout(() => {
      state.active = true;
      milestoneRef.current = 0;
      setGesturePreview(new Set([verse.verseKey]));
      showToast("Glide through 5–10 Ayahs");
    }, LONG_PRESS_MS);
    gestureRef.current = state;
  };

  useEffect(() => {
    const updateGestureAt = (clientX: number, clientY: number) => {
      const gesture = gestureRef.current;
      if (!gesture?.active) return;
      const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      const verseElement = target?.closest<HTMLElement>("[data-learning-verse-key]");
      if (!verseElement) return;
      const chapterId = Number(verseElement.dataset.chapterId);
      const verseNumber = Number(verseElement.dataset.verseNumber);
      if (chapterId !== gesture.startChapterId || !Number.isInteger(verseNumber)) return;
      if (verseNumber < gesture.startVerse) return;
      const end = Math.min(gesture.startVerse + MAX_GESTURE_BLOCK - 1, verseNumber);
      const count = end - gesture.startVerse + 1;
      const keys = Array.from({ length: count }, (_, index) => verseKey(chapterId, gesture.startVerse + index));
      setGesturePreview(new Set(keys));
      if ((count === 5 || count === 10) && milestoneRef.current !== count) {
        milestoneRef.current = count;
        showToast(`${count} Ayahs selected`);
      }
    };

    const onMove = (event: PointerEvent) => updateGestureAt(event.clientX, event.clientY);
    const onTouchMove = (event: TouchEvent) => {
      if (!gestureRef.current?.active || !event.touches[0]) return;
      // Once the intentional long-press gesture has started, keep the page
      // still while the finger glides across Ayahs. Before activation, normal
      // scrolling remains untouched.
      event.preventDefault();
      updateGestureAt(event.touches[0].clientX, event.touches[0].clientY);
    };

    const onUp = () => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      if (gesture.timer) window.clearTimeout(gesture.timer);
      if (gesture.active) {
        const preview = Array.from(gesturePreview);
        const numbers = preview
          .map((key) => Number(key.split(":")[1]))
          .filter(Number.isFinite)
          .sort((a, b) => a - b);
        suppressClickKeyRef.current = gesture.startKey;
        if (numbers.length >= MIN_GESTURE_BLOCK && numbers.length <= MAX_GESTURE_BLOCK) {
          addHiddenBlock(gesture.startChapterId, numbers[0], numbers[numbers.length - 1]);
          showToast(`${numbers.length} Ayahs hidden`);
        } else {
          showToast("Select between 5 and 10 Ayahs");
        }
      }
      setGesturePreview(new Set());
      gestureRef.current = null;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [gesturePreview, addHiddenBlock, showToast]);

  const handleVerseClick = (verse: LearningVerse) => {
    if (suppressClickKeyRef.current === verse.verseKey) {
      suppressClickKeyRef.current = null;
      return;
    }
    const gesture = gestureRef.current;
    if (gesture?.timer) window.clearTimeout(gesture.timer);
    gestureRef.current = null;

    // Hidden individual Ayahs always remain tap-to-reveal, even after the
    // Hide Ayah(s) tool is switched off. Visible Ayahs only become hideable
    // while that tool is on. Whole-Surah hiding remains controlled by Hide Surah.
    if (hiddenVerses.has(verse.verseKey) || hideAyahs) {
      toggleVerseHidden(verse);
    }
  };

  /**
   * The persistent reader chrome: the Surah title bar, its Qur'an location
   * readout, and the drawer of study controls beneath it. It is rendered
   * exactly once, above the reading surface.
   */
  const renderSurahStart = (verse: LearningVerse, data: LearningPageData) => {
    const chapter = data.chapters.find((item) => item.id === verse.chapterId);
    if (!chapter) return null;

    const headerKey = "reader-chrome";
    const panelId = "learning-surah-drawer-reader-chrome";
    const isOpen = openReaderHeaderKey === headerKey;
    const drawerPanels: DrawerPanel[] = memorizationMode
      ? ["memorized-surahs", "memorized-blocks", "memorization-progress"]
      : ["controls"];
    if (!memorizationMode && hideAyahs) drawerPanels.push("range");
    if (!memorizationMode && sequenceEnabled) drawerPanels.push("sequence");
    const fallbackDrawerPanel: DrawerPanel = memorizationMode ? "memorized-surahs" : "controls";
    const activeDrawerPanel = drawerPanels.includes(drawerPanel) ? drawerPanel : fallbackDrawerPanel;
    const drawerPanelIndex = drawerPanels.indexOf(activeDrawerPanel);
    const drawerPanelCount = drawerPanels.length;
    const normalDrawerPanelCount = 1 + (hideAyahs ? 1 : 0) + (sequenceEnabled ? 1 : 0);
    const drawerPhysicalPanelIndex = memorizationMode ? normalDrawerPanelCount + drawerPanelIndex : drawerPanelIndex;
    const previousDrawerPanel = drawerPanelIndex > 0 ? drawerPanels[drawerPanelIndex - 1] : null;
    const nextDrawerPanel = drawerPanelIndex < drawerPanelCount - 1 ? drawerPanels[drawerPanelIndex + 1] : null;
    const panelLabel = (panel: DrawerPanel) => {
      if (panel === "controls") return "reader controls";
      if (panel === "range") return "Hide a range";
      if (panel === "sequence") return "Sequence activity";
      if (panel === "memorized-surahs") return "Memorized Surahs";
      if (panel === "memorized-blocks") return "Memorized Blocks";
      return "Progress";
    };

    return (
      <div className={`learning-surah-opening is-page-header ${isOpen ? "is-open" : ""} ${memorizationMode ? "is-memorization-mode" : ""}`} key={`opening-${headerKey}`}>
        <div className="learning-surah-sticky learning-reader-merged-header">
        <div className="learning-reader-header-meta">
          <div className="learning-reader-header-meta-values">
            <span>Page <b>{data.pageNumber}</b></span>
            <span>Juz <b>{formatNumberSpan(data.juzNumbers)}</b></span>
            <span>Hizb <b>{formatNumberSpan(data.hizbNumbers)}</b></span>
            <LearningBookmarkButton
              chapterId={chapter.id}
              chapterName={chapter.nameSimple}
              pageNumber={data.pageNumber}
              onNotice={showToast}
            />
          </div>
          <ToggleButton
            checked={hiddenSurahs.has(chapter.id)}
            onChange={() => toggleSurahHidden(chapter.id)}
          >
            Hide Surah
          </ToggleButton>
        </div>

        <button
          type="button"
          className="learning-surah-title learning-surah-title-hero"
          aria-expanded={isOpen}
          aria-controls={panelId}
          aria-description="Tap for reader controls. Press and hold for memorization tracking."
          onPointerDown={beginMemorizationLongPress}
          onPointerMove={moveMemorizationLongPress}
          onPointerUp={endMemorizationLongPress}
          onPointerCancel={endMemorizationLongPress}
          onPointerLeave={endMemorizationLongPress}
          onContextMenu={(event) => event.preventDefault()}
          onClick={() => {
            if (suppressHeroClickRef.current) {
              suppressHeroClickRef.current = false;
              return;
            }
            if (isOpen) {
              setOpenReaderHeaderKey(null);
              setMemorizationMode(false);
              setDrawerPanel("controls");
              return;
            }
            setMemorizationMode(false);
            setDrawerPanel("controls");
            setOpenReaderHeaderKey(headerKey);
          }}
        >
          <span className="learning-surah-hero-kicker">Surah {chapter.id}</span>
          <span className="learning-surah-hero-title">
            <b dir="rtl" lang="ar">{chapter.nameArabic}</b>
            <span className="learning-surah-hero-copy">
              <strong>{chapter.nameSimple}</strong>
              <small>{chapter.translatedName}</small>
            </span>
          </span>
          <svg className="learning-surah-chevron" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div id={panelId} className={`learning-surah-drawer ${isOpen ? "is-open" : ""}`}>
          <div
            className={`learning-surah-drawer-inner ${drawerPanelCount > 1 ? "has-carousel-panels" : ""}`}
            onTouchStart={(event) => {
              if (drawerPanelCount <= 1) return;
              const touch = event.touches[0];
              if (touch) {
                drawerSwipeRef.current = { x: touch.clientX, y: touch.clientY };
                setDrawerDragging(true);
                setDrawerDragX(0);
              }
            }}
            onTouchMove={(event) => {
              if (drawerPanelCount <= 1 || !drawerSwipeRef.current) return;
              const touch = event.touches[0];
              if (!touch) return;
              const start = drawerSwipeRef.current;
              const dx = touch.clientX - start.x;
              const dy = touch.clientY - start.y;
              if (Math.abs(dx) <= Math.abs(dy)) return;

              event.preventDefault();

              const width = Math.max(1, event.currentTarget.clientWidth);
              let bounded = Math.max(-width, Math.min(width, dx));
              if (dx > 0 && drawerPanelIndex === 0) bounded = Math.min(width * .2, dx * .22);
              if (dx < 0 && drawerPanelIndex === drawerPanelCount - 1) bounded = Math.max(-width * .2, dx * .22);
              setDrawerDragX(bounded);
            }}
            onTouchEnd={(event) => {
              if (drawerPanelCount <= 1 || !drawerSwipeRef.current) return;
              const touch = event.changedTouches[0];
              const start = drawerSwipeRef.current;
              drawerSwipeRef.current = null;
              setDrawerDragging(false);
              if (!touch) {
                setDrawerDragX(0);
                return;
              }
              const dx = touch.clientX - start.x;
              const dy = touch.clientY - start.y;
              const threshold = Math.min(78, Math.max(46, event.currentTarget.clientWidth * .16));
              if (Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * 1.08) {
                if (dx < 0 && nextDrawerPanel) setDrawerPanel(nextDrawerPanel);
                if (dx > 0 && previousDrawerPanel) setDrawerPanel(previousDrawerPanel);
              }
              setDrawerDragX(0);
            }}
            onTouchCancel={() => {
              drawerSwipeRef.current = null;
              setDrawerDragging(false);
              setDrawerDragX(0);
            }}
          >
            {drawerPanelCount > 1 ? (
              <button
                type="button"
                className="learning-drawer-panel-arrow is-left"
                aria-label={previousDrawerPanel ? `Show ${panelLabel(previousDrawerPanel)}` : "Previous study panel"}
                disabled={!previousDrawerPanel}
                onClick={() => previousDrawerPanel && setDrawerPanel(previousDrawerPanel)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            ) : null}

            <div
              className="learning-drawer-carousel"
              style={drawerCarouselHeight ? { height: `${drawerCarouselHeight}px` } : undefined}
            >
              <div
                className={`learning-drawer-carousel-track ${drawerDragging ? "is-dragging" : ""}`}
                style={{
                  transform: `translate3d(calc(-${drawerPhysicalPanelIndex * 100}% + ${drawerDragX}px), 0, 0)`,
                }}
              >
            <div className="learning-surah-drawer-panel" ref={controlsPanelRef}>
            <div className="learning-surah-controls">
              <aside className="learning-quran-navigator" aria-label="Navigate the Qur’an">
                <div className="learning-navigator-heading">
                  <span>Navigate Qur’an</span>
                  <small>Page {data.pageNumber}</small>
                </div>

                <div className="learning-navigator-tabs" role="tablist" aria-label="Navigation type">
                  {(["surah", "verse", "juz", "page"] as NavigatorMode[]).map((mode) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={navigatorMode === mode}
                      className={navigatorMode === mode ? "is-active" : ""}
                      key={mode}
                      onClick={() => { setNavigatorMode(mode); setNavigatorError(""); }}
                    >
                      {mode === "surah" ? "Surah" : mode === "verse" ? "Verse" : mode === "juz" ? "Juz" : "Page"}
                    </button>
                  ))}
                </div>

                <div className="learning-navigator-body">
                  {navigatorMode === "surah" ? (
                    <div className="learning-surah-navigator">
                      <input
                        type="search"
                        value={navigatorSearch}
                        placeholder="Search Surah"
                        aria-label="Search Surah"
                        onChange={(event) => setNavigatorSearch(event.target.value)}
                      />
                      <div className="learning-surah-results" role="listbox" aria-label="Surahs">
                        {navigatorSurahs.map((item) => (
                          <button
                            type="button"
                            role="option"
                            aria-selected={navigatorChapterId === item.id}
                            className={navigatorChapterId === item.id ? "is-active" : ""}
                            key={item.id}
                            onClick={() => {
                              setNavigatorChapterId(item.id);
                              setRangeChapterId(item.id);
                              setNavigatorVerse("1");
                              void navigateByMode("surah", { chapterId: item.id });
                            }}
                          >
                            <span>{item.id}</span>
                            <strong>{item.nameSimple}</strong>
                            <b dir="rtl" lang="ar">{item.nameArabic}</b>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {navigatorMode === "verse" ? (
                    <div className="learning-navigator-form learning-verse-navigator">
                      <div className="learning-verse-picker" ref={verseSurahPickerRef}>
                        <span>Surah</span>
                        <button
                          type="button"
                          className="learning-picker-trigger learning-surah-picker-trigger"
                          aria-haspopup="listbox"
                          aria-expanded={verseSurahPickerOpen}
                          onClick={() => {
                            setVerseSurahPickerOpen((open) => !open);
                            setVerseAyahPickerOpen(false);
                          }}
                        >
                          <span className="learning-picker-number">{navigatorChapterId}</span>
                          <strong>{navigatorChapter?.nameSimple ?? `Surah ${navigatorChapterId}`}</strong>
                          <b dir="rtl" lang="ar">{navigatorChapter?.nameArabic ?? ""}</b>
                          <svg viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>

                        {verseSurahPickerOpen ? (
                          <div className="learning-picker-popover learning-surah-picker-popover">
                            <input
                              type="search"
                              value={verseSurahSearch}
                              placeholder="Search Surah"
                              aria-label="Search Surah for verse navigation"
                              onChange={(event) => setVerseSurahSearch(event.target.value)}
                              autoFocus
                            />
                            <div className="learning-surah-results" role="listbox" aria-label="Choose Surah">
                              {(config?.chapters ?? [])
                                .filter((item) => {
                                  const query = verseSurahSearch.trim().toLowerCase();
                                  if (!query) return true;
                                  return String(item.id).includes(query)
                                    || item.nameSimple.toLowerCase().includes(query)
                                    || item.nameArabic.includes(verseSurahSearch.trim());
                                })
                                .map((item) => (
                                  <button
                                    type="button"
                                    role="option"
                                    aria-selected={navigatorChapterId === item.id}
                                    className={navigatorChapterId === item.id ? "is-active" : ""}
                                    key={item.id}
                                    onClick={() => {
                                      setNavigatorChapterId(item.id);
                                      setRangeChapterId(item.id);
                                      setNavigatorVerse("1");
                                      setVerseSurahSearch("");
                                      setVerseSurahPickerOpen(false);
                                    }}
                                  >
                                    <span>{item.id}</span>
                                    <strong>{item.nameSimple}</strong>
                                    <b dir="rtl" lang="ar">{item.nameArabic}</b>
                                  </button>
                                ))}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="learning-verse-picker learning-ayah-picker" ref={verseAyahPickerRef}>
                        <span>Ayah</span>
                        <button
                          type="button"
                          className="learning-picker-trigger learning-ayah-picker-trigger"
                          aria-haspopup="listbox"
                          aria-expanded={verseAyahPickerOpen}
                          aria-label={`Choose an Ayah from ${navigatorChapter?.nameSimple ?? "this Surah"}`}
                          onClick={() => {
                            setVerseAyahPickerOpen((open) => !open);
                            setVerseSurahPickerOpen(false);
                          }}
                        >
                          <strong>{navigatorVerse}</strong>
                          <svg viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>

                        {verseAyahPickerOpen ? (
                          <div className="learning-picker-popover learning-ayah-picker-popover">
                            <input
                              type="search"
                              inputMode="numeric"
                              value={verseAyahSearch}
                              placeholder="Find Ayah"
                              aria-label="Find Ayah"
                              onChange={(event) => setVerseAyahSearch(event.target.value.replace(/\D/g, ""))}
                              autoFocus
                            />
                            <div className="learning-ayah-results" role="listbox" aria-label="Choose Ayah">
                              {Array.from(
                                { length: navigatorChapter?.versesCount ?? 1 },
                                (_, index) => index + 1,
                              )
                                .filter((ayahNumber) => {
                                  const query = verseAyahSearch.trim();
                                  return !query || String(ayahNumber).includes(query);
                                })
                                .map((ayahNumber) => (
                                  <button
                                    type="button"
                                    role="option"
                                    aria-selected={Number(navigatorVerse) === ayahNumber}
                                    className={Number(navigatorVerse) === ayahNumber ? "is-active" : ""}
                                    value={ayahNumber}
                                    key={ayahNumber}
                                    onClick={() => {
                                      setNavigatorVerse(String(ayahNumber));
                                      setVerseAyahSearch("");
                                      setVerseAyahPickerOpen(false);
                                    }}
                                  >
                                    <span>{ayahNumber}</span>
                                  </button>
                                ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <button type="button" className="learning-navigator-go" disabled={navigatorLoading} onClick={() => void navigateByMode("verse")}>Go</button>
                    </div>
                  ) : null}

                  {navigatorMode === "juz" ? (
                    <div className="learning-navigator-form learning-number-navigator learning-list-number-navigator">
                      <div className="learning-verse-picker learning-number-picker" ref={juzPickerRef}>
                        <span>Juz</span>
                        <button
                          type="button"
                          className="learning-picker-trigger learning-number-picker-trigger"
                          aria-haspopup="listbox"
                          aria-expanded={juzPickerOpen}
                          onClick={() => {
                            setJuzPickerOpen((open) => !open);
                            setPagePickerOpen(false);
                          }}
                        >
                          <strong>{navigatorJuz}</strong>
                          <span className="learning-picker-total">/ 30</span>
                          <svg viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>

                        {juzPickerOpen ? (
                          <div className="learning-picker-popover learning-number-picker-popover">
                            <input
                              type="search"
                              inputMode="numeric"
                              value={juzSearch}
                              placeholder="Find Juz"
                              aria-label="Find Juz"
                              onChange={(event) => setJuzSearch(event.target.value.replace(/\D/g, ""))}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                const value = Number(juzSearch);
                                if (Number.isInteger(value) && value >= 1 && value <= 30) {
                                  setNavigatorJuz(String(value));
                                  setJuzPickerOpen(false);
                                  setJuzSearch("");
                                  void navigateByMode("juz", { juzNumber: value });
                                }
                              }}
                              autoFocus
                            />
                            <div className="learning-ayah-results" role="listbox" aria-label="Choose Juz">
                              {Array.from({ length: 30 }, (_, index) => index + 1)
                                .filter((number) => !juzSearch.trim() || String(number).includes(juzSearch.trim()))
                                .map((number) => (
                                  <button
                                    type="button"
                                    role="option"
                                    aria-selected={Number(navigatorJuz) === number}
                                    className={Number(navigatorJuz) === number ? "is-active" : ""}
                                    key={number}
                                    onClick={() => {
                                      setNavigatorJuz(String(number));
                                      setJuzSearch("");
                                      setJuzPickerOpen(false);
                                    }}
                                  >
                                    <span>{number}</span>
                                  </button>
                                ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <button type="button" className="learning-navigator-go" disabled={navigatorLoading} onClick={() => void navigateByMode("juz")}>Go</button>
                    </div>
                  ) : null}

                  {navigatorMode === "page" ? (
                    <div className="learning-navigator-form learning-number-navigator learning-list-number-navigator">
                      <div className="learning-verse-picker learning-number-picker" ref={pagePickerRef}>
                        <span>Page</span>
                        <button
                          type="button"
                          className="learning-picker-trigger learning-number-picker-trigger"
                          aria-haspopup="listbox"
                          aria-expanded={pagePickerOpen}
                          onClick={() => {
                            setPagePickerOpen((open) => !open);
                            setJuzPickerOpen(false);
                          }}
                        >
                          <strong>{pageJump || currentPage}</strong>
                          <span className="learning-picker-total">/ {LEARNING_TOTAL_PAGES}</span>
                          <svg viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>

                        {pagePickerOpen ? (
                          <div className="learning-picker-popover learning-number-picker-popover">
                            <input
                              type="search"
                              inputMode="numeric"
                              value={pageSearch}
                              placeholder="Find page"
                              aria-label="Find page"
                              onChange={(event) => setPageSearch(event.target.value.replace(/\D/g, ""))}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                const value = Number(pageSearch);
                                if (Number.isInteger(value) && value >= 1 && value <= LEARNING_TOTAL_PAGES) {
                                  setPageJump(String(value));
                                  setPagePickerOpen(false);
                                  setPageSearch("");
                                  void navigateByMode("page", { pageNumber: value });
                                }
                              }}
                              autoFocus
                            />
                            <div className="learning-ayah-results learning-page-results" role="listbox" aria-label="Choose page">
                              {Array.from({ length: LEARNING_TOTAL_PAGES }, (_, index) => index + 1)
                                .filter((number) => !pageSearch.trim() || String(number).includes(pageSearch.trim()))
                                .map((number) => (
                                  <button
                                    type="button"
                                    role="option"
                                    aria-selected={Number(pageJump) === number}
                                    className={Number(pageJump) === number ? "is-active" : ""}
                                    key={number}
                                    onClick={() => {
                                      setPageJump(String(number));
                                      setPageSearch("");
                                      setPagePickerOpen(false);
                                    }}
                                  >
                                    <span>{number}</span>
                                  </button>
                                ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <button type="button" className="learning-navigator-go" disabled={navigatorLoading} onClick={() => void navigateByMode("page")}>Go</button>
                    </div>
                  ) : null}
                </div>

                {navigatorError ? <p className="learning-navigator-error" role="status">{navigatorError}</p> : null}
              </aside>

              <div className="learning-surah-reader-controls">
                <div className="learning-control-group">
                  <span>View</span>
                  <div className="learning-segmented">
                    <button type="button" className={layout === "book" ? "is-active" : ""} onClick={() => changeLayout("book")}>Book</button>
                    <button type="button" className={layout === "scroll" ? "is-active" : ""} onClick={() => changeLayout("scroll")}>Scroll</button>
                  </div>
                </div>

                <div className="learning-control-group learning-content-mode">
                  <span>Read</span>
                  <div className="learning-segmented">
                    <button type="button" className={display === "arabic" ? "is-active" : ""} onClick={() => setDisplay("arabic")}>Mushaf</button>
                    <button type="button" className={display === "verse-translation" ? "is-active" : ""} onClick={() => setDisplay("verse-translation")}>Ayah + translation</button>
                    <button type="button" className={display === "translation" ? "is-active" : ""} onClick={() => setDisplay("translation")}>Translation</button>
                  </div>
                </div>

                <div className="learning-control-group learning-language-control">
                  <label htmlFor={`learning-language-${data.pageNumber}-${chapter.id}`}>Translation</label>
                  <select
                    id={`learning-language-${data.pageNumber}-${chapter.id}`}
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                  >
                    {(config?.languages ?? []).filter((item) => item.available).map((item) => (
                      <option key={item.id} value={item.id}>{capitalizeWords(item.label)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="learning-surah-study-controls">
                <div className="learning-control-group learning-font-size-control">
                  <span>Text size</span>
                  <div className="learning-font-stepper" aria-label="Adjust reader font size">
                    <button type="button" onClick={decreaseFontScale} aria-label="Decrease font size">A−</button>
                    <strong>{Math.round(fontScale * 100)}%</strong>
                    <button type="button" onClick={increaseFontScale} aria-label="Increase font size">A+</button>
                  </div>
                </div>

                <div className="learning-toolbar-toggles">
                  <ToggleButton
                    checked={hideAyahs}
                    onChange={(checked) => {
                      setHideAyahs(checked);
                      if (!checked && drawerPanel === "range") {
                        setDrawerPanel(sequenceEnabled ? "sequence" : "controls");
                      }
                    }}
                  >
                    Hide Ayah(s)
                  </ToggleButton>
                  <ToggleButton
                    checked={sequenceEnabled}
                    onChange={(checked) => {
                      setSequenceEnabled(checked);
                      if (checked) {
                        setDrawerPanel("sequence");
                      } else if (drawerPanel === "sequence") {
                        setDrawerPanel(hideAyahs ? "range" : "controls");
                      }
                    }}
                  >
                    Sequence
                  </ToggleButton>
                </div>
              </div>
            </div>
            </div>

            {hideAyahs ? (
              <div className="learning-surah-drawer-panel learning-range-drawer-panel" ref={rangePanelRef}>
                <section className="learning-hide-tools learning-hide-tools-in-drawer">
                  <div className="learning-range-intro">
                    <p className="learning-tool-title">Hide a range</p>
                    <p className="learning-tool-copy">Tap individual Ayahs, press and hold then glide across 5–10 Ayahs, or enter a range below.</p>
                  </div>

                  <div className="learning-range-form">
                    <div className="learning-verse-picker learning-range-surah-picker" ref={rangeSurahPickerRef}>
                      <span>Surah</span>
                      <button
                        type="button"
                        className="learning-picker-trigger learning-surah-picker-trigger"
                        aria-haspopup="listbox"
                        aria-expanded={rangeSurahPickerOpen}
                        onClick={() => setRangeSurahPickerOpen((open) => !open)}
                      >
                        <span className="learning-picker-number">{rangeChapterId}</span>
                        <strong>{config?.chapters.find((item) => item.id === rangeChapterId)?.nameSimple ?? `Surah ${rangeChapterId}`}</strong>
                        <b dir="rtl" lang="ar">{config?.chapters.find((item) => item.id === rangeChapterId)?.nameArabic ?? ""}</b>
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>

                      {rangeSurahPickerOpen ? (
                        <div className="learning-picker-popover learning-surah-picker-popover">
                          <input
                            type="search"
                            value={rangeSurahSearch}
                            placeholder="Search Surah"
                            aria-label="Search Surah for range hiding"
                            onChange={(event) => setRangeSurahSearch(event.target.value)}
                            autoFocus
                          />
                          <div className="learning-surah-results" role="listbox" aria-label="Choose Surah for range hiding">
                            {(config?.chapters ?? [])
                              .filter((item) => {
                                const query = rangeSurahSearch.trim().toLowerCase();
                                if (!query) return true;
                                return String(item.id).includes(query)
                                  || item.nameSimple.toLowerCase().includes(query)
                                  || item.nameArabic.includes(rangeSurahSearch.trim());
                              })
                              .map((item) => (
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={rangeChapterId === item.id}
                                  className={rangeChapterId === item.id ? "is-active" : ""}
                                  key={item.id}
                                  onClick={() => {
                                    setRangeChapterId(item.id);
                                    setRangeSurahSearch("");
                                    setRangeSurahPickerOpen(false);
                                  }}
                                >
                                  <span>{item.id}</span>
                                  <strong>{item.nameSimple}</strong>
                                  <b dir="rtl" lang="ar">{item.nameArabic}</b>
                                </button>
                              ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <label>
                      <span>Ayah range</span>
                      <input
                        type="text"
                        value={rangeInput}
                        onChange={(event) => setRangeInput(event.target.value)}
                        placeholder={config?.chapters.find((item) => item.id === rangeChapterId) ? `1-${Math.min(10, config?.chapters.find((item) => item.id === rangeChapterId)?.versesCount ?? 10)}` : "7-12 or 7,12"}
                        inputMode="text"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                    </label>
                    <button type="button" className="learning-range-apply" onClick={applyRange}>Hide / reveal</button>
                  </div>
                  {rangeMessage ? <p className="learning-range-message" role="status">{rangeMessage}</p> : null}
                </section>
              </div>
            ) : null}

            {sequenceEnabled ? (
              <div className="learning-surah-drawer-panel learning-sequence-drawer-panel" ref={sequencePanelRef}>
                <section className="learning-sequence-panel learning-sequence-panel-in-drawer">
                  <header>
                    <div>
                      <p className="learning-tool-title">Sequence practice</p>
                      <p className="learning-tool-copy">Hidden 5–10 Ayah blocks become a shuffled bank. Put each Ayah back in its original order.</p>
                    </div>
                    {eligibleBlocks.length ? (
                      <label className="learning-block-picker">
                        <span>Hidden block</span>
                        <select value={activeBlockId} onChange={(event) => setActiveBlockId(event.target.value)}>
                          {eligibleBlocks.map((block) => {
                            const blockChapter = config?.chapters.find((item) => item.id === block.chapterId);
                            return (
                              <option value={block.id} key={block.id}>
                                {blockChapter?.nameSimple ?? `Surah ${block.chapterId}`} · {block.start}–{block.end}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    ) : null}
                  </header>

                  {!eligibleBlocks.length ? (
                    <div className="learning-sequence-empty">Hide a block of 5–10 consecutive Ayahs first. It will appear here automatically.</div>
                  ) : sequenceLoading ? (
                    <div className="learning-sequence-empty">Loading the hidden block…</div>
                  ) : sequenceError ? (
                    <div className="learning-error">{sequenceError}</div>
                  ) : sequenceData ? (
                    <>
                      <div className="learning-sequence-slots" aria-label="Sequence positions">
                        {sequenceSlots.map((id, index) => {
                          const sequenceVerse = id ? sequenceVerseByKey.get(id) : null;
                          return (
                            <button
                              type="button"
                              key={index}
                              className={`learning-sequence-slot ${sequenceLocked[index] ? "is-correct" : ""} ${id ? "is-filled" : ""}`}
                              disabled={sequenceLocked[index]}
                              onClick={() => {
                                if (sequenceLocked[index]) return;
                                setSequenceSlots((previous) => previous.map((item, slot) => slot === index ? null : item));
                              }}
                              onDragOver={(event) => { if (!sequenceLocked[index]) event.preventDefault(); }}
                              onDrop={(event) => {
                                event.preventDefault();
                                const choice = event.dataTransfer.getData("text/plain");
                                if (choice) placeSequenceChoice(choice, index);
                              }}
                            >
                              <span className="learning-slot-index">{index + 1}</span>
                              {sequenceVerse ? (
                                <span className="learning-sequence-slot-copy">
                                  {display !== "translation" ? <b dir="rtl" lang="ar">{sequenceVerse.arabic}</b> : null}
                                  {display !== "arabic" ? <small>{sequenceVerse.translation}</small> : null}
                                </span>
                              ) : <span className="learning-slot-placeholder">Place Ayah {index + 1}</span>}
                            </button>
                          );
                        })}
                      </div>

                      <div className="learning-ayah-bank" aria-label="Ayah bank">
                        {availableSequenceIds.map((id) => {
                          const sequenceVerse = sequenceVerseByKey.get(id);
                          if (!sequenceVerse) return null;
                          return (
                            <button
                              type="button"
                              key={id}
                              className="learning-bank-card"
                              onClick={() => placeSequenceChoice(id)}
                              draggable
                              onDragStart={(event: DragEvent<HTMLButtonElement>) => {
                                event.dataTransfer.setData("text/plain", id);
                                event.dataTransfer.effectAllowed = "move";
                              }}
                            >
                              {display !== "translation" ? <b dir="rtl" lang="ar">{sequenceVerse.arabic}</b> : null}
                              {display !== "arabic" ? <small>{sequenceVerse.translation}</small> : null}
                            </button>
                          );
                        })}
                      </div>

                      <div className="learning-sequence-actions">
                        <p role="status">{sequenceMessage || `${sequenceSlots.filter(Boolean).length}/${sequenceSlots.length} placed`}</p>
                        <button type="button" className="secondary" onClick={resetSequence}>Reset</button>
                        <button type="button" className="primary" disabled={sequenceSlots.some((item) => !item)} onClick={checkSequence}>Check sequence</button>
                      </div>
                    </>
                  ) : null}
                </section>
              </div>
            ) : null}

            <div className="learning-surah-drawer-panel learning-memorization-panel" ref={memorizedSurahsPanelRef}>
              <section className="learning-memorization-section">
                <header className="learning-memorization-heading">
                  <div>
                    <p className="learning-tool-title">Memorized Surahs</p>
                    <p className="learning-tool-copy">Choose one or more Surahs, then mark them In Progress or Memorized.</p>
                  </div>
                  <span className="learning-memorization-panel-count">1 / 3</span>
                </header>

                <div className="learning-memorization-form-row">
                  <div className="learning-verse-picker learning-memorized-surah-picker" ref={memorizedSurahPickerRef}>
                    <span>Surahs</span>
                    <button
                      type="button"
                      className="learning-picker-trigger learning-surah-picker-trigger"
                      aria-haspopup="listbox"
                      aria-expanded={memorizedSurahPickerOpen}
                      onClick={() => setMemorizedSurahPickerOpen((open) => !open)}
                    >
                      <strong>{memorizedSurahSelection.size ? `${memorizedSurahSelection.size} selected` : "Select Surahs"}</strong>
                      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>

                    {memorizedSurahPickerOpen ? (
                      <div className="learning-picker-popover learning-surah-picker-popover learning-multi-surah-popover">
                        <input
                          type="search"
                          value={memorizedSurahSearch}
                          placeholder="Search Surah"
                          aria-label="Search Surahs to track"
                          onChange={(event) => setMemorizedSurahSearch(event.target.value)}
                          autoFocus
                        />
                        <div className="learning-surah-results" role="listbox" aria-multiselectable="true" aria-label="Choose Surahs to track">
                          {(config?.chapters ?? [])
                            .filter((item) => {
                              const query = memorizedSurahSearch.trim().toLowerCase();
                              if (!query) return true;
                              return String(item.id).includes(query)
                                || item.nameSimple.toLowerCase().includes(query)
                                || item.nameArabic.includes(memorizedSurahSearch.trim());
                            })
                            .map((item) => {
                              const selected = memorizedSurahSelection.has(item.id);
                              return (
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={selected}
                                  className={selected ? "is-active" : ""}
                                  key={item.id}
                                  onClick={() => {
                                    setMemorizedSurahSelection((previous) => {
                                      const next = new Set(previous);
                                      if (next.has(item.id)) next.delete(item.id);
                                      else next.add(item.id);
                                      return next;
                                    });
                                  }}
                                >
                                  <span>{item.id}</span>
                                  <strong>{item.nameSimple}</strong>
                                  <b dir="rtl" lang="ar">{item.nameArabic}</b>
                                  <i className="learning-multi-select-check" aria-hidden="true">{selected ? "✓" : ""}</i>
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="learning-memorization-status-control">
                    <span>Status</span>
                    <div className="learning-status-segmented" role="group" aria-label="Surah memorization status">
                      <button type="button" className={memorizedSurahStatus === "in-progress" ? "is-active" : ""} onClick={() => setMemorizedSurahStatus("in-progress")}>In Progress</button>
                      <button type="button" className={memorizedSurahStatus === "memorized" ? "is-active" : ""} onClick={() => setMemorizedSurahStatus("memorized")}>Memorized</button>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="primary learning-memorization-save"
                    disabled={!memorizedSurahSelection.size}
                    onClick={() => updateMemorizedSurahs(memorizedSurahStatus)}
                  >
                    Apply
                  </button>
                </div>

                <div className="learning-memorization-records" aria-label="Tracked Surahs">
                  {memorizedSurahs.length ? memorizedSurahs.map((record) => {
                    const item = config?.chapters.find((chapterItem) => chapterItem.id === record.chapterId);
                    if (!item) return null;
                    return (
                      <article className="learning-memorization-record" key={record.chapterId}>
                        <div className="learning-memorization-record-title">
                          <span>{item.id}</span>
                          <strong>{item.nameSimple}</strong>
                          <b dir="rtl" lang="ar">{item.nameArabic}</b>
                        </div>
                        <div className="learning-memorization-record-actions">
                          <button type="button" className={record.status === "in-progress" ? "is-active" : ""} onClick={() => updateMemorizedSurahsForRecord(record.chapterId, "in-progress")}>In Progress</button>
                          <button type="button" className={record.status === "memorized" ? "is-active" : ""} onClick={() => updateMemorizedSurahsForRecord(record.chapterId, "memorized")}>Memorized</button>
                          <button type="button" className="learning-record-remove" aria-label={`Remove ${item.nameSimple}`} onClick={() => removeMemorizedSurah(record.chapterId)}>×</button>
                        </div>
                      </article>
                    );
                  }) : <div className="learning-memorization-empty">No Surahs tracked yet.</div>}
                </div>
              </section>
            </div>

            <div className="learning-surah-drawer-panel learning-memorization-panel" ref={memorizedBlocksPanelRef}>
              <section className="learning-memorization-section">
                <header className="learning-memorization-heading">
                  <div>
                    <p className="learning-tool-title">Memorized Blocks</p>
                    <p className="learning-tool-copy">Choose any consecutive Ayah range inside a Surah as long as the block contains 5–10 Ayahs.</p>
                  </div>
                  <span className="learning-memorization-panel-count">2 / 3</span>
                </header>

                <div className="learning-memorization-form-row learning-memorized-block-form">
                  <div className="learning-verse-picker" ref={memorizedBlockSurahPickerRef}>
                    <span>Surah</span>
                    <button
                      type="button"
                      className="learning-picker-trigger learning-surah-picker-trigger"
                      aria-haspopup="listbox"
                      aria-expanded={memorizedBlockSurahPickerOpen}
                      onClick={() => setMemorizedBlockSurahPickerOpen((open) => !open)}
                    >
                      <span className="learning-picker-number">{memorizedBlockChapterId}</span>
                      <strong>{config?.chapters.find((item) => item.id === memorizedBlockChapterId)?.nameSimple ?? `Surah ${memorizedBlockChapterId}`}</strong>
                      <b dir="rtl" lang="ar">{config?.chapters.find((item) => item.id === memorizedBlockChapterId)?.nameArabic ?? ""}</b>
                      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>

                    {memorizedBlockSurahPickerOpen ? (
                      <div className="learning-picker-popover learning-surah-picker-popover">
                        <input
                          type="search"
                          value={memorizedBlockSurahSearch}
                          placeholder="Search Surah"
                          aria-label="Search Surah for memorized block"
                          onChange={(event) => setMemorizedBlockSurahSearch(event.target.value)}
                          autoFocus
                        />
                        <div className="learning-surah-results" role="listbox" aria-label="Choose Surah for memorized block">
                          {(config?.chapters ?? [])
                            .filter((item) => {
                              const query = memorizedBlockSurahSearch.trim().toLowerCase();
                              if (!query) return true;
                              return String(item.id).includes(query)
                                || item.nameSimple.toLowerCase().includes(query)
                                || item.nameArabic.includes(memorizedBlockSurahSearch.trim());
                            })
                            .map((item) => (
                              <button
                                type="button"
                                role="option"
                                aria-selected={memorizedBlockChapterId === item.id}
                                className={memorizedBlockChapterId === item.id ? "is-active" : ""}
                                key={item.id}
                                onClick={() => {
                                  setMemorizedBlockChapterId(item.id);
                                  setMemorizedBlockSurahSearch("");
                                  setMemorizedBlockSurahPickerOpen(false);
                                }}
                              >
                                <span>{item.id}</span>
                                <strong>{item.nameSimple}</strong>
                                <b dir="rtl" lang="ar">{item.nameArabic}</b>
                              </button>
                            ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <label className="learning-memorized-range-input">
                    <span>Ayah range</span>
                    <input
                      type="text"
                      inputMode="text"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      value={memorizedBlockRange}
                      onChange={(event) => setMemorizedBlockRange(event.target.value)}
                      placeholder="7-12 or 7,12"
                    />
                  </label>

                  <div className="learning-memorization-status-control">
                    <span>Status</span>
                    <div className="learning-status-segmented" role="group" aria-label="Block memorization status">
                      <button type="button" className={memorizedBlockStatus === "in-progress" ? "is-active" : ""} onClick={() => setMemorizedBlockStatus("in-progress")}>In Progress</button>
                      <button type="button" className={memorizedBlockStatus === "memorized" ? "is-active" : ""} onClick={() => setMemorizedBlockStatus("memorized")}>Memorized</button>
                    </div>
                  </div>

                  <button type="button" className="primary learning-memorization-save" onClick={saveMemorizedBlock}>Save block</button>
                </div>

                {memorizedBlockMessage ? <p className="learning-range-message" role="status">{memorizedBlockMessage}</p> : null}

                <div className="learning-memorization-records" aria-label="Tracked memorized blocks">
                  {memorizedBlocks.length ? memorizedBlocks.map((record) => {
                    const item = config?.chapters.find((chapterItem) => chapterItem.id === record.chapterId);
                    return (
                      <article className="learning-memorization-record learning-memorization-block-record" key={record.id}>
                        <button
                          type="button"
                          className="learning-memorization-record-title learning-memorization-block-link"
                          onClick={() => void openMemorizedBlock(record)}
                          aria-label={`Open ${item?.nameSimple ?? `Surah ${record.chapterId}`} Ayahs ${record.start} to ${record.end}`}
                        >
                          <span>{item?.id ?? record.chapterId}</span>
                          <strong>{item?.nameSimple ?? `Surah ${record.chapterId}`} · {record.start}–{record.end}</strong>
                          <b dir="rtl" lang="ar">{item?.nameArabic ?? ""}</b>
                        </button>
                        <div className="learning-memorization-record-actions">
                          <button type="button" className={record.status === "in-progress" ? "is-active" : ""} onClick={() => setMemorizedBlockRecordStatus(record.id, "in-progress")}>In Progress</button>
                          <button type="button" className={record.status === "memorized" ? "is-active" : ""} onClick={() => setMemorizedBlockRecordStatus(record.id, "memorized")}>Memorized</button>
                          <button type="button" className="learning-record-remove" aria-label={`Remove ${item?.nameSimple ?? "block"} ${record.start} to ${record.end}`} onClick={() => removeMemorizedBlock(record.id)}>×</button>
                        </div>
                      </article>
                    );
                  }) : <div className="learning-memorization-empty">No Ayah blocks tracked yet.</div>}
                </div>
              </section>
            </div>

            <div className="learning-surah-drawer-panel learning-memorization-panel" ref={memorizationProgressPanelRef}>
              <section className="learning-memorization-section learning-memorization-progress">
                <header className="learning-memorization-heading">
                  <div>
                    <p className="learning-tool-title">Progress</p>
                    <p className="learning-tool-copy">A quick view of what you are learning and what you have completed.</p>
                  </div>
                  <span className="learning-memorization-panel-count">3 / 3</span>
                </header>

                <div className="learning-memorization-stats">
                  <article><strong>{memorizedSurahs.filter((item) => item.status === "memorized").length}</strong><span>Surahs memorized</span></article>
                  <article><strong>{memorizedSurahs.filter((item) => item.status === "in-progress").length}</strong><span>Surahs in progress</span></article>
                  <article><strong>{memorizedBlocks.filter((item) => item.status === "memorized").length}</strong><span>Blocks memorized</span></article>
                  <article><strong>{memorizedBlocks.filter((item) => item.status === "in-progress").length}</strong><span>Blocks in progress</span></article>
                </div>

                <div className="learning-memorization-progress-note">
                  <strong>{memorizedSurahs.length + memorizedBlocks.length ? "Keep building from what you have already marked." : "Start by marking a Surah or Ayah block."}</strong>
                  <span>Your progress is stored on this device with the rest of your Learning Blocks preferences.</span>
                </div>
              </section>
            </div>

              </div>
            </div>

            {drawerPanelCount > 1 ? (
              <button
                type="button"
                className="learning-drawer-panel-arrow is-right"
                aria-label={nextDrawerPanel ? `Show ${panelLabel(nextDrawerPanel)}` : "Next study panel"}
                disabled={!nextDrawerPanel}
                onClick={() => nextDrawerPanel && setDrawerPanel(nextDrawerPanel)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            ) : null}
          </div>
        </div>
        </div>

      </div>
    );
  };

  const renderVerse = (verse: LearningVerse) => {
    const surahHidden = hiddenSurahs.has(verse.chapterId);
    const hidden = surahHidden || hiddenVerses.has(verse.verseKey);
    const previewed = gesturePreview.has(verse.verseKey);
    const blockFlashed = Boolean(
      memorizedBlockFlash
      && memorizedBlockFlash.chapterId === verse.chapterId
      && verse.verseNumber >= memorizedBlockFlash.start
      && verse.verseNumber <= memorizedBlockFlash.end,
    );
    const common = {
      "data-learning-verse-key": verse.verseKey,
      "data-learning-page-number": verse.pageNumber,
      "data-chapter-id": verse.chapterId,
      "data-verse-number": verse.verseNumber,
      onPointerDown: (event: ReactPointerEvent) => beginGesture(event, verse),
      onContextMenu: (event: ReactMouseEvent) => { if (hideAyahs) event.preventDefault(); },
      onClick: () => handleVerseClick(verse),
    };

    /*
     * The children below carry explicit keys even though they are a fixed
     * list. Spreading `common` into the element stops the JSX transform from
     * marking the children as static, so React validates them as a dynamic
     * array and warns that they need keys. The keys are constant strings, so
     * reconciliation is unaffected; they exist to keep that list valid. Any
     * child added here needs one too.
     */
    if (display === "arabic") {
      return (
        <span
          {...common}
          key={verse.verseKey}
          className={`learning-mushaf-verse ${hidden ? "is-hidden" : ""} ${previewed ? "is-preview" : ""} ${navigationTargetKey === verse.verseKey ? "is-navigation-target" : ""} ${blockFlashed ? "is-memorized-block-flash" : ""} ${hideAyahs ? "is-interactive" : ""}`}
        >
          <span key="text" className="learning-arabic-text" dir="rtl" lang="ar" translate="no" aria-hidden={hidden || undefined}>{verse.arabic}</span>
          <AyahMarker
            key="marker"
            number={verse.verseNumber}
            saved={savedAyahs.has(verse.verseKey)}
            onToggleSave={() => toggleAyahSaved(verse)}
          />
        </span>
      );
    }

    return (
      <article
        {...common}
        key={verse.verseKey}
        className={`learning-verse-row ${hidden ? "is-hidden" : ""} ${previewed ? "is-preview" : ""} ${navigationTargetKey === verse.verseKey ? "is-navigation-target" : ""} ${blockFlashed ? "is-memorized-block-flash" : ""} ${hideAyahs ? "is-interactive" : ""}`}
      >
        <div key="head" className="learning-verse-row-head">
          <span>Ayah {verse.verseNumber}</span>
          <AyahMarker
            number={verse.verseNumber}
            saved={savedAyahs.has(verse.verseKey)}
            onToggleSave={() => toggleAyahSaved(verse)}
          />
        </div>
        {display === "verse-translation" ? (
          <p key="arabic" className="learning-row-arabic" dir="rtl" lang="ar" translate="no" aria-hidden={hidden || undefined}>{verse.arabic}</p>
        ) : null}
        <p key="translation" className="learning-row-translation" aria-hidden={hidden || undefined}>{verse.translation || "Translation unavailable for this Ayah."}</p>
      </article>
    );
  };

  const renderSurah = (data: LearningSurahData, options?: { snapshot?: boolean }) => {
    const chapter = data.chapter;
    const snapshot = options?.snapshot ?? false;
    return (
      <section
        className="learning-surah-reading-surface"
        id={snapshot ? undefined : `learning-surah-${chapter.id}`}
        data-learning-surah={snapshot ? undefined : chapter.id}
        aria-hidden={snapshot || undefined}
      >
        <div
          className={`learning-page-content display-${display}`}
          style={{
            ["--learning-mushaf-min" as string]: `${30 * fontScale}px`,
            ["--learning-mushaf-fluid" as string]: `${3.65 * fontScale}vw`,
            ["--learning-mushaf-max" as string]: `${52 * fontScale}px`,
            ["--learning-mushaf-mobile-min" as string]: `${29 * fontScale}px`,
            ["--learning-mushaf-mobile-fluid" as string]: `${9 * fontScale}vw`,
            ["--learning-mushaf-mobile-max" as string]: `${38 * fontScale}px`,
            ["--learning-row-min" as string]: `${28 * fontScale}px`,
            ["--learning-row-fluid" as string]: `${3 * fontScale}vw`,
            ["--learning-row-max" as string]: `${40 * fontScale}px`,
            ["--learning-basmala-min" as string]: `${28 * fontScale}px`,
            ["--learning-basmala-fluid" as string]: `${3 * fontScale}vw`,
            ["--learning-basmala-max" as string]: `${42 * fontScale}px`,
            ["--learning-basmala-mobile-min" as string]: `${26 * fontScale}px`,
            ["--learning-basmala-mobile-fluid" as string]: `${8 * fontScale}vw`,
            ["--learning-basmala-mobile-max" as string]: `${34 * fontScale}px`,
            ["--learning-translation-size" as string]: `${13 * Math.min(fontScale, 1.25)}px`,
          }}
        >
          {chapter.id !== 9 && chapter.id !== 1 ? (
            <div className="learning-surah-content-basmala learning-basmala" dir="rtl" lang="ar" translate="no">
              {BASMALA}
            </div>
          ) : null}

          {chapter.id === 9 ? (
            <small className="learning-no-basmala learning-surah-content-note">
              At-Tawbah begins without the Bismillah.
            </small>
          ) : null}

          {display === "arabic" ? (
            <div className="learning-mushaf-flow" dir="rtl">
              {data.verses.map((verse) => renderVerse(verse))}
            </div>
          ) : (
            <div className="learning-verse-list">
              {data.verses.map((verse) => (
                <div key={`surah-verse-${verse.verseKey}`}>{renderVerse(verse)}</div>
              ))}
            </div>
          )}
        </div>

        <footer className="learning-page-footer learning-surah-footer">
          <span>{chapter.nameSimple}</span>
          <span>{data.translationMeta.author}</span>
        </footer>
      </section>
    );
  };

  const navigatorChapter = config?.chapters.find((chapter) => chapter.id === navigatorChapterId) ?? null;
  const navigatorSurahs = useMemo(() => {
    const query = navigatorSearch.trim().toLowerCase();
    const chapters = config?.chapters ?? [];
    if (!query) return chapters;
    return chapters.filter((chapter) =>
      String(chapter.id) === query
      || chapter.nameSimple.toLowerCase().includes(query)
      || chapter.nameArabic.includes(navigatorSearch.trim()),
    ).slice(0, 16);
  }, [config?.chapters, navigatorSearch]);
  const decreaseFontScale = () => setFontScale((previous) => Math.max(0.8, Math.round((previous - 0.1) * 100) / 100));
  const increaseFontScale = () => setFontScale((previous) => Math.min(1.4, Math.round((previous + 0.1) * 100) / 100));

  const beginMemorizationLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    memorizationPressStartRef.current = { x: event.clientX, y: event.clientY };
    if (memorizationLongPressTimerRef.current) window.clearTimeout(memorizationLongPressTimerRef.current);
    memorizationLongPressTimerRef.current = window.setTimeout(() => {
      suppressHeroClickRef.current = true;
      setMemorizationMode(true);
      setDrawerPanel("memorized-surahs");
      setMemorizedBlockChapterId(currentChapterId);
      setOpenReaderHeaderKey("reader-chrome");
      if (navigator?.vibrate) navigator.vibrate(18);
    }, 520);
  };

  const moveMemorizationLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = memorizationPressStartRef.current;
    if (!start || !memorizationLongPressTimerRef.current) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 11) {
      window.clearTimeout(memorizationLongPressTimerRef.current);
      memorizationLongPressTimerRef.current = null;
    }
  };

  const endMemorizationLongPress = () => {
    memorizationPressStartRef.current = null;
    if (memorizationLongPressTimerRef.current) {
      window.clearTimeout(memorizationLongPressTimerRef.current);
      memorizationLongPressTimerRef.current = null;
    }
  };

  const updateMemorizedSurahs = (status: MemorizationStatus) => {
    if (!memorizedSurahSelection.size) return;
    const now = Date.now();
    setMemorizedSurahs((previous) => {
      const next = new Map<number, MemorizedSurahRecord>(previous.map((record) => [record.chapterId, record]));
      memorizedSurahSelection.forEach((chapterId) => next.set(chapterId, { chapterId, status, updatedAt: now }));
      return Array.from(next.values()).sort((a, b) => a.chapterId - b.chapterId);
    });
    setMemorizedSurahSelection(new Set());
    setMemorizedSurahStatus(status);
  };

  const removeMemorizedSurah = (chapterId: number) => {
    setMemorizedSurahs((previous) => previous.filter((record) => record.chapterId !== chapterId));
  };

  const updateMemorizedSurahsForRecord = (chapterId: number, status: MemorizationStatus) => {
    setMemorizedSurahs((previous) => previous.map((record) => record.chapterId === chapterId ? { ...record, status, updatedAt: Date.now() } : record));
  };

  const saveMemorizedBlock = () => {
    const chapter = config?.chapters.find((item) => item.id === memorizedBlockChapterId);
    if (!chapter) {
      setMemorizedBlockMessage("Choose a Surah first.");
      return;
    }
    const parsed = parseAyahRange(memorizedBlockRange, chapter.versesCount);
    if (!parsed) {
      setMemorizedBlockMessage(`Enter a valid Ayah range within Surah ${chapter.id}.`);
      return;
    }
    const count = parsed.end - parsed.start + 1;
    if (count < MIN_GESTURE_BLOCK || count > MAX_GESTURE_BLOCK) {
      setMemorizedBlockMessage("Use any start and end Ayah as long as the block contains 5–10 consecutive Ayahs.");
      return;
    }
    const id = `${memorizedBlockChapterId}:${parsed.start}-${parsed.end}`;
    const now = Date.now();
    setMemorizedBlocks((previous) => [
      ...previous.filter((record) => record.id !== id),
      { id, chapterId: memorizedBlockChapterId, start: parsed.start, end: parsed.end, status: memorizedBlockStatus, updatedAt: now },
    ].sort((a, b) => b.updatedAt - a.updatedAt));
    setMemorizedBlockMessage(`${chapter.nameSimple} ${parsed.start}–${parsed.end} marked ${memorizedBlockStatus === "memorized" ? "Memorized" : "In Progress"}.`);
    setMemorizedBlockRange("");
  };

  const openMemorizedBlock = async (record: MemorizedBlockRecord) => {
    setMemorizedBlockMessage("");
    setMemorizationMode(false);
    setDrawerPanel("controls");
    setOpenReaderHeaderKey(null);

    try {
      const params = new URLSearchParams({
        type: "verse",
        chapter: String(record.chapterId),
        verse: String(record.start),
      });
      const response = await fetch(`/api/quran/learning/navigate?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not open that memorized block.");

      setMemorizedBlockFlash({ chapterId: record.chapterId, start: record.start, end: record.end });
      navigateSurah(record.chapterId, Number.isInteger(data.pageNumber) ? data.pageNumber : undefined);
    } catch (error) {
      setMemorizedBlockMessage(error instanceof Error ? error.message : "Could not open that memorized block.");
    }
  };

  const setMemorizedBlockRecordStatus = (id: string, status: MemorizationStatus) => {
    setMemorizedBlocks((previous) => previous.map((record) => record.id === id ? { ...record, status, updatedAt: Date.now() } : record));
  };

  const removeMemorizedBlock = (id: string) => {
    setMemorizedBlocks((previous) => previous.filter((record) => record.id !== id));
  };

  /*
   * ======================================================================
   * Scroll view: a continuous vertical stack of Surahs
   * ======================================================================
   *
   * Two rules keep this from misbehaving while the reader scrolls:
   *
   * 1. The callbacks below never change identity. They read the stack and the
   *    loaded Surahs through refs, so a Surah finishing loading does not
   *    rebuild the observers. When it did, every load tore down and re-created
   *    the sentinel observer, which fired again immediately because the
   *    sentinel was still on screen — each load kicking off the next, which is
   *    the burst of loading this replaced.
   *
   * 2. Extension is gated until the new content has actually rendered, not
   *    merely been requested, so overlapping scroll events cannot stack up
   *    several loads for the same edge.
   */

  const scrollChaptersRef = useRef(scrollChapters);
  const surahsRef = useRef(surahs);
  const loadSurahRef = useRef(loadSurah);
  const captureReadingPositionRef = useRef(captureReadingPosition);
  const currentChapterIdRef = useRef(currentChapterId);

  useEffect(() => { scrollChaptersRef.current = scrollChapters; }, [scrollChapters]);
  useEffect(() => { surahsRef.current = surahs; }, [surahs]);
  useEffect(() => { loadSurahRef.current = loadSurah; }, [loadSurah]);
  useEffect(() => { captureReadingPositionRef.current = captureReadingPosition; }, [captureReadingPosition]);
  useEffect(() => { currentChapterIdRef.current = currentChapterId; }, [currentChapterId]);

  /*
   * Adding a Surah above the viewport pushes everything below it down. The
   * correction records only the document height, never a scroll position:
   * the reader usually keeps scrolling between the request and the render,
   * and restoring a remembered position would yank them back to where they
   * were when the load started. Applying the height difference to wherever
   * they are now preserves that movement.
   */
  const captureScrollAnchor = useCallback(() => {
    scrollAnchorRef.current = { height: document.documentElement.scrollHeight };
  }, []);

  /**
   * False while a Surah is inside its cool-off after a failed load. Read-only:
   * loadSurah owns the map. Checked here so a Surah that is still backing off
   * does not take the extension gate and block the other direction.
   */
  const canRetryScrollChapter = useCallback((chapterId: number) => {
    const failedAt = scrollLoadFailedAtRef.current.get(chapterId);
    return failedAt === undefined || Date.now() - failedAt >= SCROLL_RETRY_AFTER_MS;
  }, []);

  useBrowserLayoutEffect(() => {
    // The stack has rendered, so the next extension is allowed to start.
    scrollExtendingRef.current = false;

    const anchor = scrollAnchorRef.current;
    if (!anchor) return;
    scrollAnchorRef.current = null;

    const delta = document.documentElement.scrollHeight - anchor.height;
    if (delta === 0) return;

    // A correction, not the reader scrolling, so neither the global header nor
    // the reading-position capture should treat it as movement.
    suppressHeaderAutoHide();
    restoringReadingPositionRef.current = true;
    window.scrollTo({ top: Math.max(0, window.scrollY + delta), behavior: INSTANT_SCROLL });
    window.requestAnimationFrame(() => {
      restoringReadingPositionRef.current = false;
    });
  }, [scrollChapters, suppressHeaderAutoHide]);

  /** Bring in the Surah after the last one mounted. */
  const extendScrollForward = useCallback(async () => {
    if (scrollExtendingRef.current) return;

    const chapters = scrollChaptersRef.current;
    const last = chapters[chapters.length - 1];
    if (!Number.isInteger(last) || last >= 114) return;

    const next = last + 1;
    if (!canRetryScrollChapter(next)) return;
    scrollExtendingRef.current = true;

    if (!surahsRef.current[next] && !(await loadSurahRef.current(next, false, true))) {
      scrollExtendingRef.current = false;
      return;
    }

    let changed = false;
    setScrollChapters((previous) => {
      if (previous[previous.length - 1] !== last) return previous;
      changed = true;
      const grown = [...previous, next];
      // Dropping from the front removes content above the viewport, so the
      // reader has to be held in place for that too.
      if (grown.length > MAX_SCROLL_PANELS) {
        captureScrollAnchor();
        return grown.slice(grown.length - MAX_SCROLL_PANELS);
      }
      return grown;
    });

    // Nothing rendered, so the layout effect will not run to release the gate.
    if (!changed) scrollExtendingRef.current = false;
  }, [canRetryScrollChapter, captureScrollAnchor]);

  /** Bring in the Surah before the first one mounted. */
  const extendScrollBackward = useCallback(async () => {
    if (scrollExtendingRef.current) return;

    const chapters = scrollChaptersRef.current;
    const first = chapters[0];
    if (!Number.isInteger(first) || first <= 1) return;

    const earlier = first - 1;
    if (!canRetryScrollChapter(earlier)) return;
    scrollExtendingRef.current = true;

    if (!surahsRef.current[earlier] && !(await loadSurahRef.current(earlier, false, true))) {
      scrollExtendingRef.current = false;
      return;
    }

    let changed = false;
    captureScrollAnchor();
    setScrollChapters((previous) => {
      if (previous[0] !== first) return previous;
      changed = true;
      const grown = [earlier, ...previous];
      return grown.length > MAX_SCROLL_PANELS ? grown.slice(0, MAX_SCROLL_PANELS) : grown;
    });

    if (!changed) {
      scrollAnchorRef.current = null;
      scrollExtendingRef.current = false;
    }
  }, [canRetryScrollChapter, captureScrollAnchor]);

  /*
   * The sentinels report whether an edge is near, and fire once when one comes
   * into range. They deliberately do not drive continued loading: an edge that
   * stays on screen never fires again, and one that is re-observed fires
   * immediately, so leaning on them was what produced bursts. Continued
   * loading comes from the scroll handler below, bounded to one attempt per
   * frame.
   */
  useEffect(() => {
    if (layout !== "scroll" || !hydrated) return;
    const bottom = scrollBottomSentinelRef.current;
    if (!bottom) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) scrollBottomEdgeVisibleRef.current = entry.isIntersecting;
      if (scrollBottomEdgeVisibleRef.current) void extendScrollForward();
    }, { rootMargin: "900px 0px" });

    observer.observe(bottom);
    return () => {
      observer.disconnect();
      scrollBottomEdgeVisibleRef.current = false;
    };
  }, [extendScrollForward, hydrated, layout]);

  /*
   * Growing upward additionally waits for a real upward scroll: the top of the
   * stack is on screen the moment a Surah opens, so reacting to the sentinel
   * alone would fetch the previous Surah every time the reader arrives.
   */
  useEffect(() => {
    if (layout !== "scroll" || !hydrated) return;
    const top = scrollTopSentinelRef.current;
    if (!top) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) scrollTopEdgeVisibleRef.current = entry.isIntersecting;
      if (scrollTopEdgeVisibleRef.current && scrollWentUpRef.current) void extendScrollBackward();
    }, { rootMargin: "700px 0px" });

    observer.observe(top);
    return () => {
      observer.disconnect();
      scrollTopEdgeVisibleRef.current = false;
    };
  }, [extendScrollBackward, hydrated, layout]);

  useEffect(() => {
    if (layout !== "scroll" || !hydrated) return;

    let lastY = window.scrollY;
    let queued = false;

    const onScroll = () => {
      const y = window.scrollY;
      if (y < lastY - 2) scrollWentUpRef.current = true;
      lastY = y;
      if (queued) return;

      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        if (scrollExtendingRef.current) return;
        if (scrollBottomEdgeVisibleRef.current) void extendScrollForward();
        else if (scrollWentUpRef.current && scrollTopEdgeVisibleRef.current) void extendScrollBackward();
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [extendScrollBackward, extendScrollForward, hydrated, layout]);

  /*
   * Whichever Surah occupies the reading line becomes the current one, so the
   * header, the bookmark and the saved reading position all follow along as
   * the reader moves between Surahs.
   */
  useEffect(() => {
    if (layout !== "scroll") return;

    const panels = Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-chapter]"));
    if (panels.length < 2) return;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;

      const chapterId = Number((visible.target as HTMLElement).dataset.scrollChapter);
      if (!Number.isInteger(chapterId) || chapterId === currentChapterIdRef.current) return;

      // Save where reading stopped in the Surah being left behind. Done here
      // rather than inside the state updater, which React may run more than
      // once and which must stay free of side effects. This is a scroll, not a
      // navigation, so no restore is requested — the reader keeps moving.
      captureReadingPositionRef.current(currentChapterIdRef.current);
      currentChapterIdRef.current = chapterId;
      setCurrentChapterId(chapterId);
    }, {
      rootMargin: "-30% 0px -60% 0px",
      threshold: 0,
    });

    panels.forEach((panel) => observer.observe(panel));
    return () => observer.disconnect();
    // captureReadingPosition is read through a ref: it changes on every
    // reading-position update, and rebuilding this observer that often would
    // make it fire again on content already on screen.
  }, [layout, scrollChapters, surahs]);

  const currentSurahData = surahs[currentChapterId] ?? null;
  const bookFlipTargetData = bookFlipTargetChapterId ? (surahs[bookFlipTargetChapterId] ?? null) : null;
  const activeSurahVerse = currentSurahData?.verses.find((verse) => verse.pageNumber === currentPage)
    ?? currentSurahData?.verses[0]
    ?? null;
  const activePageVerses = currentSurahData?.verses.filter((verse) => verse.pageNumber === currentPage) ?? [];
  const readerHeaderData: LearningPageData | null = currentSurahData && activeSurahVerse
    ? {
        pageNumber: currentPage,
        totalPages: LEARNING_TOTAL_PAGES,
        juzNumbers: Array.from(new Set(activePageVerses.map((verse) => verse.juzNumber))),
        hizbNumbers: Array.from(new Set(activePageVerses.map((verse) => verse.hizbNumber))),
        chapters: [currentSurahData.chapter],
        verses: activePageVerses.length ? activePageVerses : [activeSurahVerse],
        translationMeta: currentSurahData.translationMeta,
      }
    : null;

  useEffect(() => {
    if (!currentSurahData) return;
    setNavigatorChapterId(currentSurahData.chapter.id);
    setRangeChapterId(currentSurahData.chapter.id);
    setMemorizedBlockChapterId((current) => current || currentSurahData.chapter.id);
    const nextPage = currentSurahData.pages.includes(currentPage)
      ? currentPage
      : currentSurahData.pages[0] ?? 1;
    if (nextPage !== currentPage) setCurrentPage(nextPage);
    setActivePage(nextPage);
    setPageJump(String(nextPage));
  }, [currentSurahData, currentPage]);

  useEffect(() => {
    if (!currentSurahData) return;

    /*
     * Scroll view keeps several Surahs mounted, so the page readout follows
     * Ayahs across the whole stack rather than only the current Surah — the
     * page number has to keep counting as the reader crosses into the next
     * Surah, not freeze until the header catches up.
     */
    const surface = layout === "scroll"
      ? document.querySelector<HTMLElement>(".learning-scroll-stage")
      : document.getElementById(`learning-surah-${currentSurahData.chapter.id}`);
    if (!surface) return;
    const verses = Array.from(surface.querySelectorAll<HTMLElement>("[data-learning-page-number]"));
    if (!verses.length) return;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => Math.abs(a.boundingClientRect.top - 170) - Math.abs(b.boundingClientRect.top - 170))[0];
      if (!visible) return;
      const pageNumber = Number((visible.target as HTMLElement).dataset.learningPageNumber);
      if (!Number.isInteger(pageNumber)) return;
      setCurrentPage(pageNumber);
      setActivePage(pageNumber);
      setPageJump(String(pageNumber));
    }, {
      rootMargin: "-145px 0px -58% 0px",
      threshold: [0, 0.1, 0.35],
    });

    verses.forEach((verse) => observer.observe(verse));
    return () => observer.disconnect();
  }, [currentSurahData, display, layout, scrollChapters]);

  return (
    <div className="site-page-shell learning-shell">
      <SiteHeader
        navExtra={
          <ModesMenu
            activeModeId={LEARNING_BLOCKS_MODE_ID}
            onSelect={gameModeSelect}
          />
        }
      />

      <main className="content-main learning-main">
        <section className="learning-hero">
          <div className="learning-hero-copy">
            <p className="eyebrow">LEARNING · MEMORIZATION</p>
            <h1>Learning Blocks</h1>
            <p>Read naturally, hide what you want to recall, then reveal it when you are ready. There is no score and no timer.</p>
          </div>

          <LearningHeroPanel
            chapters={config?.chapters ?? []}
            currentChapterId={currentChapterId}
            currentVerseNumber={activeSurahVerse?.verseNumber ?? 1}
            currentPageNumber={currentPage}
            onOpenPosition={openLearningPosition}
          />
        </section>

        {configError ? <div className="learning-error">{configError}</div> : null}
        {pageError ? <div className="learning-error">{pageError}</div> : null}

        {gestureToast ? <div className="learning-gesture-toast" role="status">{gestureToast}</div> : null}

        {readerHeaderData && activeSurahVerse ? (
          <div
            className="learning-global-reader-chrome"
            id="learning-reader-start"
            aria-label="Current Surah and Qur’an location"
          >
            {renderSurahStart(activeSurahVerse, readerHeaderData)}
          </div>
        ) : null}

        <section className={`learning-reader learning-layout-${layout}`}>
          {/*
            * Book view shows one Surah, so it waits for that Surah. Scroll
            * view does not: each panel carries its own loading state, so one
            * Surah that is slow or unavailable must not blank the whole stack
            * the reader is already part-way through.
            */}
          {layout !== "scroll" && !currentSurahData ? (
            <div className="learning-surah-loading" role="status">
              {loadingSurahs.has(currentChapterId) ? "Loading Surah…" : "Preparing Surah…"}
            </div>
          ) : layout === "book" ? (
            <>
              <div className="learning-book-nav is-top">
                <SurahStepButton
                  className=""
                  label="Previous Surah"
                  holdLabel="Jump to the beginning of the Qur’an"
                  disabled={currentChapterId <= 1 || bookSwipeNavigating}
                  onStep={() => turnBookSurah("previous")}
                  onJump={jumpToQuranStart}
                >
                  ← Previous Surah
                </SurahStepButton>
                <span>{currentSurahData.chapter.nameSimple} · {currentSurahData.chapter.versesCount} Ayahs</span>
                <SurahStepButton
                  className=""
                  label="Next Surah"
                  holdLabel="Jump to the end of the Qur’an"
                  disabled={currentChapterId >= 114 || bookSwipeNavigating}
                  onStep={() => turnBookSurah("next")}
                  onJump={jumpToQuranEnd}
                >
                  Next Surah →
                </SurahStepButton>
              </div>
              <div
                ref={bookCarouselRef}
                className={`learning-book-flip-shell ${bookSwipeDragging ? "is-swipe-dragging" : ""} ${bookSwipeNavigating ? "is-swipe-navigating" : ""} is-flip-${bookFlipPhase}`}
                data-flip-direction={bookFlipDirection ?? undefined}
              >
                <div className="learning-book-underlay" aria-hidden="true">
                  {bookFlipTargetData ? renderSurah(bookFlipTargetData, { snapshot: true }) : null}
                </div>
                <div
                  ref={bookStageRef}
                  className={`learning-book-stage ${bookSwipeDragging ? "is-swipe-dragging" : ""} ${bookSwipeNavigating ? "is-swipe-navigating" : ""} is-flip-${bookFlipPhase}`}
                  onTouchStart={beginBookSwipe}
                  onTouchMove={moveBookSwipe}
                  onTouchEnd={endBookSwipe}
                  onTouchCancel={cancelBookSwipe}
                  onTransitionEnd={(event) => {
                    if (event.target === event.currentTarget && event.propertyName === "transform") {
                      finishBookSurahTurn();
                    }
                  }}
                >
                  {renderSurah(currentSurahData)}
                </div>
              </div>
              <div className="learning-book-nav">
                <SurahStepButton
                  className=""
                  label="Previous Surah"
                  holdLabel="Jump to the beginning of the Qur’an"
                  disabled={currentChapterId <= 1 || bookSwipeNavigating}
                  onStep={() => turnBookSurah("previous")}
                  onJump={jumpToQuranStart}
                >
                  ← Previous Surah
                </SurahStepButton>
                <span>{currentSurahData.chapter.nameSimple} · {currentSurahData.chapter.versesCount} Ayahs</span>
                <SurahStepButton
                  className=""
                  label="Next Surah"
                  holdLabel="Jump to the end of the Qur’an"
                  disabled={currentChapterId >= 114 || bookSwipeNavigating}
                  onStep={() => turnBookSurah("next")}
                  onJump={jumpToQuranEnd}
                >
                  Next Surah →
                </SurahStepButton>
              </div>
            </>
          ) : (
            <div className="learning-scroll-stage">
              {/* Pulls in the previous Surah as the reader approaches the top. */}
              <div ref={scrollTopSentinelRef} className="learning-scroll-sentinel" aria-hidden="true" />

              {scrollChapters[0] > 1 ? (
                <p className="learning-scroll-edge" role="status">
                  {loadingSurahs.has(scrollChapters[0] - 1)
                    ? "Loading the previous Surah…"
                    : "Keep scrolling up for the previous Surah"}
                </p>
              ) : (
                <p className="learning-scroll-edge is-terminus">Beginning of the Qur’an</p>
              )}

              {scrollChapters.map((chapterId) => {
                const data = surahs[chapterId];
                const chapter = data?.chapter ?? config?.chapters.find((item) => item.id === chapterId) ?? null;

                return (
                  <section
                    className={`learning-scroll-surah ${chapterId === currentChapterId ? "is-current" : ""}`}
                    key={chapterId}
                    data-scroll-chapter={chapterId}
                    aria-label={chapter ? `Surah ${chapterId}, ${chapter.nameSimple}` : `Surah ${chapterId}`}
                  >
                    <header className="learning-scroll-surah-head">
                      <span className="learning-scroll-surah-kicker">Surah {chapterId}</span>
                      <b dir="rtl" lang="ar">{chapter?.nameArabic ?? ""}</b>
                      <strong>{chapter?.nameSimple ?? `Surah ${chapterId}`}</strong>
                      <small>{chapter?.translatedName ?? ""}</small>
                    </header>

                    {data ? renderSurah(data) : (
                      <div className="learning-scroll-surah-loading" role="status">
                        {loadingSurahs.has(chapterId) ? "Loading Surah…" : "Preparing Surah…"}
                      </div>
                    )}

                    <p className="learning-scroll-surah-end">
                      End of {chapter?.nameSimple ?? `Surah ${chapterId}`}
                    </p>
                  </section>
                );
              })}

              {scrollChapters[scrollChapters.length - 1] < 114 ? (
                <p className="learning-scroll-edge" role="status">
                  {loadingSurahs.has(scrollChapters[scrollChapters.length - 1] + 1)
                    ? "Loading the next Surah…"
                    : "Keep scrolling for the next Surah"}
                </p>
              ) : (
                <p className="learning-scroll-edge is-terminus">End of the Qur’an</p>
              )}

              {/* Pulls in the next Surah as the reader approaches the bottom. */}
              <div ref={scrollBottomSentinelRef} className="learning-scroll-sentinel" aria-hidden="true" />

              <nav className="learning-scroll-pager" aria-label="Surah navigation">
                <SurahStepButton
                  className="learning-scroll-pager-button"
                  label="Previous Surah"
                  holdLabel="Jump to the beginning of the Qur’an"
                  disabled={currentChapterId <= 1}
                  onStep={() => navigateSurah(currentChapterId - 1)}
                  onJump={jumpToQuranStart}
                >
                  {/* The previous Surah sits above in the stack, so the arrow
                      points the way the button travels. */}
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </SurahStepButton>

                <span className="learning-scroll-pager-label" aria-hidden="true">{currentChapterId}</span>

                <SurahStepButton
                  className="learning-scroll-pager-button"
                  label="Next Surah"
                  holdLabel="Jump to the end of the Qur’an"
                  disabled={currentChapterId >= 114}
                  onStep={() => navigateSurah(currentChapterId + 1)}
                  onJump={jumpToQuranEnd}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5v14M6 13l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </SurahStepButton>
              </nav>
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
