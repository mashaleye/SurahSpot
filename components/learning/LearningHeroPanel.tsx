"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { NotificationSettings } from "@/components/pwa/NotificationSettings";
import type { LearningChapter } from "@/lib/learning/types";
import { syncNotificationState } from "@/lib/pwa/notifications-client";
import {
  DEFAULT_DAILY_AYAH_GOAL,
  MAX_DAILY_AYAH_GOAL,
  MAX_LIST_ITEMS,
  MIN_DAILY_AYAH_GOAL,
  addLearningListAyah,
  addLearningListSurah,
  ayahListItemId,
  clampGoal,
  clearLearningGoal,
  clearLearningList,
  getLearningProgressServerSnapshot,
  getLearningProgressSnapshot,
  isSurahInLearningList,
  localDayKey,
  recentDayKeys,
  removeLearningListItem,
  surahListItemId,
  setLearningGoal,
  subscribeLearningProgress,
  type LearningListItem,
} from "@/lib/learning/progress";

type LearningHeroPanelProps = {
  chapters: readonly LearningChapter[];
  currentChapterId: number;
  currentVerseNumber: number;
  currentPageNumber: number;
  /**
   * Open a saved entry. A verse number highlights that exact Ayah on arrival;
   * null means a whole-Surah bookmark, which resumes where reading stopped.
   */
  onOpenPosition: (chapterId: number, verseNumber: number | null, pageNumber: number) => void;
};

type ModalKind = "navigate" | "goal" | "list" | "streak" | null;

const GOAL_PRESETS = [5, 10, 20, 50] as const;
const STREAK_STRIP_DAYS = 7;
const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

function ChevronIcon() {
  return (
    <svg className="learning-continue-chevron" viewBox="0 0 20 20" aria-hidden="true">
      <path d="m7.5 4.5 6 5.5-6 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SproutIcon() {
  return (
    <svg className="learning-streak-icon" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 28v-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16 19c0-4.2-3.1-7.4-7.6-7.7-.5 0-.8.4-.7.9.8 4 4 6.8 8.3 6.8Z" fill="currentColor" />
      <path d="M16 19c0-5 3.6-8.6 8.8-9 .5 0 .9.4.8.9-.9 4.7-4.7 8.1-9.6 8.1Z" fill="currentColor" opacity=".72" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg className="learning-list-icon" viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M9 5.5h14a1.5 1.5 0 0 1 1.5 1.5v19.1a.9.9 0 0 1-1.42.73L16 21.6l-7.08 5.23A.9.9 0 0 1 7.5 26.1V7A1.5 1.5 0 0 1 9 5.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

type LearningBookmarkButtonProps = {
  chapterId: number;
  chapterName: string;
  pageNumber: number;
  onNotice: (message: string) => void;
};

/**
 * The bookmark beside the Page/Juz/Hizb readout: saves this Surah to My List.
 *
 * It saves the Surah itself, not a position inside it — individual Ayahs are
 * saved by tapping their medallion, and the two are independent, so removing
 * the Surah leaves any Ayahs saved within it alone.
 *
 * It subscribes to a boolean rather than to the progress snapshot. The
 * snapshot changes on every reading-position update — that is, constantly
 * while scrolling — so selecting a primitive lets React bail out of every
 * re-render except the one where the saved state genuinely flips.
 */
export function LearningBookmarkButton({
  chapterId,
  chapterName,
  pageNumber,
  onNotice,
}: LearningBookmarkButtonProps) {
  const saved = useSyncExternalStore(
    subscribeLearningProgress,
    () => isSurahInLearningList(chapterId),
    () => false,
  );

  const toggle = useCallback(() => {
    if (saved) {
      removeLearningListItem(surahListItemId(chapterId));
      onNotice(`Removed ${chapterName} from My List.`);
      return;
    }

    const added = addLearningListSurah(chapterId, pageNumber);
    onNotice(
      added
        ? `Saved ${chapterName} to My List.`
        : `${chapterName} is already on your list.`,
    );
  }, [chapterId, chapterName, onNotice, pageNumber, saved]);

  return (
    <button
      type="button"
      className={`learning-meta-bookmark ${saved ? "is-saved" : ""}`}
      aria-pressed={saved}
      aria-label={saved ? `Remove Surah ${chapterName} from My List` : `Save Surah ${chapterName} to My List`}
      title={saved ? "Surah saved to My List" : "Save this Surah to My List"}
      onClick={toggle}
    >
      {saved ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M7 4h10a1.2 1.2 0 0 1 1.2 1.2v14.6a.7.7 0 0 1-1.1.57L12 16.6l-5.1 3.77A.7.7 0 0 1 5.8 19.8V5.2A1.2 1.2 0 0 1 7 4Z"
            fill="currentColor"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M7 4h10a1.2 1.2 0 0 1 1.2 1.2v14.6a.7.7 0 0 1-1.1.57L12 16.6l-5.1 3.77A.7.7 0 0 1 5.8 19.8V5.2A1.2 1.2 0 0 1 7 4Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

function CompassIcon() {
  return (
    <svg className="learning-navigate-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="m15.4 8.6-2 4.8-4.8 2 2-4.8Z" fill="currentColor" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 10.9v5.4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="12" cy="7.8" r="1.15" fill="currentColor" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg className="learning-goal-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/**
 * One modal shell for all four panels: portal, backdrop dismiss, Escape,
 * scroll lock with scrollbar-gap compensation, and focus handed to the close
 * button. It matches the behaviour of the existing share sheet so the reader
 * has a single modal idiom rather than four slightly different ones.
 */
function LearningModal({
  open,
  title,
  eyebrow,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.documentElement.style.overflow;
    const previousBodyPadding = document.body.style.paddingRight;
    const scrollbarGap = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const previouslyFocused = document.activeElement as HTMLElement | null;

    document.documentElement.style.overflow = "hidden";
    if (scrollbarGap > 0) document.body.style.paddingRight = `${scrollbarGap}px`;

    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus({ preventScroll: true }), 30);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }

      // Keep Tab inside the dialog. Without this the reader behind the
      // backdrop stays reachable by keyboard while it is visually blocked.
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown, true);
      document.documentElement.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousBodyPadding;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="learning-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={`learning-modal ${wide ? "is-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="learning-modal-handle" aria-hidden="true" />
        <header className="learning-modal-header">
          <div>
            <p>{eyebrow}</p>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="learning-modal-close"
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="learning-modal-body">{children}</div>

        {footer ? <footer className="learning-modal-footer">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}

/**
 * Schematic mini-mockups of the real interface, one per guide section.
 *
 * They are drawn from the theme tokens rather than captured as images, so they
 * stay sharp at any size, follow light and dark mode, and cannot drift out of
 * date the way a screenshot does. Purely decorative: each card's text carries
 * the meaning, so the figures are hidden from assistive technology.
 */
function GuideFigure({ kind }: { kind: GuideFigureKind }) {
  const common = { viewBox: "0 0 160 96", role: "presentation", "aria-hidden": true as const };

  if (kind === "navigate") {
    return (
      <svg {...common}>
        <rect className="lg-surface" x="8" y="10" width="144" height="32" rx="9" />
        <rect className="lg-line" x="18" y="19" width="26" height="5" rx="2.5" />
        <rect className="lg-accent" x="18" y="29" width="44" height="6" rx="3" />
        <path className="lg-stroke" d="m134 23 5 5 5-5" />
        <rect className="lg-surface" x="8" y="50" width="144" height="36" rx="9" />
        <rect className="lg-accent-soft" x="15" y="57" width="31" height="22" rx="7" />
        <rect className="lg-accent" x="23" y="66" width="15" height="5" rx="2.5" />
        <rect className="lg-line" x="53" y="66" width="24" height="5" rx="2.5" />
        <rect className="lg-line" x="86" y="66" width="18" height="5" rx="2.5" />
        <rect className="lg-line" x="113" y="66" width="28" height="5" rx="2.5" />
      </svg>
    );
  }

  if (kind === "place") {
    return (
      <svg {...common}>
        <rect className="lg-surface" x="8" y="10" width="64" height="76" rx="9" />
        <rect className="lg-line" x="18" y="22" width="44" height="5" rx="2.5" />
        <rect className="lg-line" x="18" y="34" width="44" height="5" rx="2.5" />
        <rect className="lg-line" x="18" y="46" width="30" height="5" rx="2.5" />
        <rect className="lg-surface" x="88" y="10" width="64" height="76" rx="9" />
        <rect className="lg-line" x="98" y="22" width="44" height="5" rx="2.5" />
        <rect className="lg-accent-soft" x="92" y="40" width="56" height="20" rx="6" />
        <rect className="lg-accent" x="98" y="47" width="36" height="6" rx="3" />
        <path className="lg-accent" d="M137 40h8v17l-4-3-4 3Z" />
        <rect className="lg-line" x="98" y="68" width="30" height="5" rx="2.5" />
      </svg>
    );
  }

  if (kind === "hide") {
    return (
      <svg {...common}>
        <rect className="lg-surface" x="8" y="8" width="144" height="80" rx="10" />
        <rect className="lg-line" x="20" y="20" width="120" height="6" rx="3" />
        <rect className="lg-hidden" x="20" y="34" width="120" height="14" rx="6" />
        <rect className="lg-hidden" x="20" y="54" width="94" height="14" rx="6" />
        <rect className="lg-line" x="20" y="76" width="70" height="6" rx="3" />
        <circle className="lg-accent" cx="118" cy="61" r="9" opacity=".22" />
        <circle className="lg-accent" cx="118" cy="61" r="4" />
      </svg>
    );
  }

  if (kind === "sequence") {
    return (
      <svg {...common}>
        <rect className="lg-surface" x="8" y="8" width="66" height="80" rx="9" />
        <rect className="lg-accent-soft" x="15" y="15" width="52" height="19" rx="6" />
        <rect className="lg-accent" x="22" y="22" width="30" height="5" rx="2.5" />
        <rect className="lg-outline" x="15" y="38" width="52" height="19" rx="6" />
        <rect className="lg-outline" x="15" y="61" width="52" height="19" rx="6" />
        <rect className="lg-surface" x="86" y="8" width="66" height="80" rx="9" />
        <rect className="lg-card" x="93" y="16" width="52" height="18" rx="6" />
        <rect className="lg-line" x="100" y="23" width="30" height="4" rx="2" />
        <rect className="lg-card" x="93" y="39" width="52" height="18" rx="6" />
        <rect className="lg-line" x="100" y="46" width="22" height="4" rx="2" />
        <rect className="lg-card" x="93" y="62" width="52" height="18" rx="6" />
        <rect className="lg-line" x="100" y="69" width="34" height="4" rx="2" />
      </svg>
    );
  }

  if (kind === "memorize") {
    return (
      <svg {...common}>
        <rect className="lg-surface" x="8" y="8" width="144" height="80" rx="10" />
        <rect className="lg-line" x="20" y="19" width="48" height="6" rx="3" />
        <rect className="lg-card" x="18" y="33" width="124" height="22" rx="7" />
        <circle className="lg-accent-soft-fill" cx="31" cy="44" r="7" />
        <rect className="lg-line" x="44" y="41" width="34" height="5" rx="2.5" />
        <rect className="lg-accent" x="98" y="38" width="36" height="12" rx="6" />
        <rect className="lg-card" x="18" y="59" width="124" height="22" rx="7" />
        <circle className="lg-accent-soft-fill" cx="31" cy="70" r="7" />
        <rect className="lg-line" x="44" y="67" width="44" height="5" rx="2.5" />
        <rect className="lg-outline" x="98" y="64" width="36" height="12" rx="6" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <rect className="lg-surface" x="8" y="10" width="144" height="30" rx="9" />
      <rect className="lg-line" x="18" y="22" width="26" height="6" rx="3" />
      <rect className="lg-card" x="84" y="17" width="58" height="17" rx="8" />
      <rect className="lg-accent" x="91" y="23" width="9" height="5" rx="2.5" />
      <rect className="lg-line" x="107" y="23" width="6" height="5" rx="2.5" />
      <rect className="lg-accent" x="123" y="22" width="11" height="7" rx="3.5" />
      <rect className="lg-surface" x="8" y="48" width="144" height="38" rx="9" />
      <rect className="lg-accent-soft" x="15" y="56" width="43" height="22" rx="7" />
      <rect className="lg-accent" x="24" y="65" width="25" height="5" rx="2.5" />
      <rect className="lg-line" x="67" y="65" width="33" height="5" rx="2.5" />
      <rect className="lg-line" x="109" y="65" width="35" height="5" rx="2.5" />
    </svg>
  );
}

type GuideFigureKind = "navigate" | "place" | "hide" | "sequence" | "memorize" | "comfort";

const NAVIGATE_SECTIONS: Array<{ title: string; body: string; points: string[]; figure: GuideFigureKind }> = [
  {
    title: "Move through the Qur’an",
    figure: "navigate",
    body: "Tap the Surah title bar to open the reader controls. The Navigate panel jumps by Surah, Verse, Juz, or Page.",
    points: [
      "Book view turns one Surah at a time — swipe sideways, use the arrow keys, or the Previous/Next buttons.",
      "Scroll view keeps the whole Surah in one continuous column.",
      "Choosing a Surah returns you to where you left off in it; choosing a Verse, Juz, or Page goes exactly there.",
    ],
  },
  {
    title: "Your place is kept",
    figure: "place",
    body: "Every Surah remembers where you stopped reading, separately from the others.",
    points: [
      "A Surah you have never opened starts at its first Ayah.",
      "A Surah you have read before reopens at the Ayah you left on.",
      "This works the same in Book view and Scroll view, on desktop and on your phone.",
    ],
  },
  {
    title: "Hide Ayahs to test recall",
    figure: "hide",
    body: "Turn on Hide Ayah(s) in the reader controls, then hide as much or as little as you want.",
    points: [
      "Tap a single Ayah to hide it. Tap again to reveal it.",
      "Press and hold an Ayah, then glide down across 5–10 Ayahs to hide a block in one gesture.",
      "Or type an exact range such as 7-12 in the Hide a range panel.",
      "A hidden Ayah always stays tap-to-reveal, even after you switch the tool off.",
    ],
  },
  {
    title: "Put a block back in order",
    figure: "sequence",
    body: "Turn on Sequence. Any hidden block of 5–10 consecutive Ayahs becomes a shuffled ordering exercise.",
    points: [
      "Drag a card into a slot, or tap it to fill the next open position.",
      "Check sequence locks the positions you placed correctly so you only redo the rest.",
      "There is no score and no timer — reset and try again as often as you like.",
    ],
  },
  {
    title: "Track what you are memorizing",
    figure: "memorize",
    body: "Press and hold the Surah title bar to open memorization tracking.",
    points: [
      "Mark whole Surahs, or 5–10 Ayah blocks, as In Progress or Memorized.",
      "Swipe between Memorized Surahs, Memorized Blocks, and Progress.",
      "Tap any tracked block to jump straight to it in the reader.",
    ],
  },
  {
    title: "Make it comfortable to read",
    figure: "comfort",
    body: "The reader controls adjust how the text itself looks.",
    points: [
      "Mushaf shows Arabic alone; Ayah + translation shows both; Translation shows the meaning alone.",
      "Text size scales the Arabic and the translation together.",
      "Pick any available translation language — your choice is remembered.",
    ],
  },
];

export function LearningHeroPanel({
  chapters,
  currentChapterId,
  currentVerseNumber,
  currentPageNumber,
  onOpenPosition,
}: LearningHeroPanelProps) {
  const snapshot = useSyncExternalStore(
    subscribeLearningProgress,
    getLearningProgressSnapshot,
    getLearningProgressServerSnapshot,
  );

  const [modal, setModal] = useState<ModalKind>(null);
  const [goalDraft, setGoalDraft] = useState(String(DEFAULT_DAILY_AYAH_GOAL));
  const [listNotice, setListNotice] = useState("");
  const listNoticeTimerRef = useRef<number | null>(null);

  const chapterById = useMemo(
    () => new Map(chapters.map((chapter) => [chapter.id, chapter])),
    [chapters],
  );

  const closeModal = useCallback(() => setModal(null), []);

  useEffect(() => () => {
    if (listNoticeTimerRef.current) window.clearTimeout(listNoticeTimerRef.current);
  }, []);

  const showListNotice = useCallback((message: string) => {
    setListNotice(message);
    if (listNoticeTimerRef.current) window.clearTimeout(listNoticeTimerRef.current);
    listNoticeTimerRef.current = window.setTimeout(() => setListNotice(""), 2400);
  }, []);

  const openGoalModal = useCallback(() => {
    setGoalDraft(String(snapshot.goal?.ayahsPerDay ?? DEFAULT_DAILY_AYAH_GOAL));
    setModal("goal");
  }, [snapshot.goal?.ayahsPerDay]);

  const openPosition = useCallback((chapterId: number, verseNumber: number | null, pageNumber: number) => {
    closeModal();
    onOpenPosition(chapterId, verseNumber, pageNumber);
  }, [closeModal, onOpenPosition]);

  const lastRead = snapshot.lastRead;
  const lastReadChapter = lastRead ? chapterById.get(lastRead.chapterId) ?? null : null;

  const goalTarget = snapshot.goal?.ayahsPerDay ?? 0;
  const goalPercent = goalTarget > 0
    ? Math.min(100, Math.round((snapshot.todayCount / goalTarget) * 100))
    : 0;
  const goalMet = goalTarget > 0 && snapshot.todayCount >= goalTarget;

  /*
   * The exact Ayah to save. The store's last-read entry is Ayah-accurate and
   * updates as the reader scrolls, so it is preferred whenever it refers to
   * the Surah on screen. The props are the fallback for the moment just after
   * navigating, before the first reading position of the new Surah is taken.
   */
  const current = useMemo(() => {
    if (lastRead && lastRead.chapterId === currentChapterId) {
      return {
        chapterId: currentChapterId,
        verseNumber: lastRead.verseNumber,
        pageNumber: lastRead.pageNumber,
      };
    }
    return {
      chapterId: currentChapterId,
      verseNumber: currentVerseNumber,
      pageNumber: currentPageNumber,
    };
  }, [currentChapterId, currentPageNumber, currentVerseNumber, lastRead]);

  const currentIsSaved = snapshot.list.some(
    (item) => item.id === ayahListItemId(current.chapterId, current.verseNumber),
  );

  /*
   * Keep the server's idea of the streak current.
   *
   * Reading progress lives on the device and stays there; the evening streak
   * reminder needs only two facts to be honest about whether it should fire
   * at all — the last day read and the count — so only those are sent, and
   * only when they change. Telling someone their streak is at risk when it
   * is not is the fastest way to have reminders switched off for good.
   */
  const lastDayRead = snapshot.days.length ? snapshot.days[snapshot.days.length - 1] : null;
  useEffect(() => {
    void syncNotificationState({
      streak: snapshot.streak,
      lastReadDay: lastDayRead ?? undefined,
    });
  }, [lastDayRead, snapshot.streak]);

  const streakDays = useMemo(() => {
    const today = localDayKey();
    const active = new Set(snapshot.days);
    return recentDayKeys(STREAK_STRIP_DAYS, today).map((key) => ({
      key,
      active: active.has(key),
      isToday: key === today,
      label: WEEKDAY_INITIALS[new Date(`${key}T00:00:00`).getDay()],
    }));
  }, [snapshot.days]);

  const saveCurrentPosition = useCallback(() => {
    const added = addLearningListAyah(current.chapterId, current.verseNumber, current.pageNumber);
    const chapter = chapterById.get(current.chapterId);
    const name = chapter?.nameSimple ?? `Surah ${current.chapterId}`;
    showListNotice(
      added
        ? `Saved ${name} · Verse ${current.verseNumber} to My List.`
        : `${name} · Verse ${current.verseNumber} is already on your list.`,
    );
  }, [chapterById, current, showListNotice]);

  const renderListRow = (item: LearningListItem) => {
    const chapter = chapterById.get(item.chapterId);
    const name = chapter?.nameSimple ?? `Surah ${item.chapterId}`;
    const isSurah = item.kind === "surah";
    const label = isSurah ? `Surah ${name}` : `${name} Verse ${item.verseNumber}`;

    return (
      <li className="learning-list-row" key={item.id}>
        <button
          type="button"
          className="learning-list-row-open"
          onClick={() => openPosition(item.chapterId, item.verseNumber, item.pageNumber)}
        >
          <span className={`learning-list-row-index ${isSurah ? "is-surah" : ""}`}>
            {isSurah ? item.chapterId : item.verseNumber}
          </span>
          <span className="learning-list-row-copy">
            <strong>{name}</strong>
            <small>
              {isSurah
                ? `Whole Surah · ${chapter ? `${chapter.versesCount} Ayahs` : `Surah ${item.chapterId}`}`
                : `Ayah ${item.verseNumber} · Page ${item.pageNumber}`}
            </small>
          </span>
          <b className="learning-list-row-arabic" dir="rtl" lang="ar">{chapter?.nameArabic ?? ""}</b>
          <ChevronIcon />
        </button>
        <button
          type="button"
          className="learning-list-row-remove"
          aria-label={`Remove ${label} from My List`}
          onClick={() => removeLearningListItem(item.id)}
        >
          <CloseIcon />
        </button>
      </li>
    );
  };

  return (
    <div className="learning-continue">
      <div className="learning-continue-head">
        <h2>Last Read</h2>
        <div className="learning-continue-head-actions">
          <button
            type="button"
            className="learning-navigate-link"
            onClick={() => setModal("navigate")}
          >
            <CompassIcon />
            <span>Navigate Learning</span>
          </button>
          <button
            type="button"
            className="learning-info-button"
            aria-label="How to use Learning Blocks"
            onClick={() => setModal("navigate")}
          >
            <InfoIcon />
          </button>
        </div>
      </div>

      <div className="learning-continue-grid">
        <button
          type="button"
          className={`learning-continue-card learning-last-read ${lastRead ? "" : "is-empty"}`}
          onClick={() => {
            if (lastRead) openPosition(lastRead.chapterId, lastRead.verseNumber, lastRead.pageNumber);
          }}
          disabled={!lastRead}
          aria-label={
            lastRead && lastReadChapter
              ? `Continue reading ${lastReadChapter.nameSimple}, verse ${lastRead.verseNumber}`
              : "No reading position saved yet"
          }
        >
          <span className="learning-last-read-arabic" dir="rtl" lang="ar" translate="no">
            {lastReadChapter?.nameArabic ?? "—"}
          </span>
          <span className="learning-last-read-foot">
            <span className="learning-last-read-name">
              {lastRead && lastReadChapter ? (
                <>
                  <strong>{lastRead.chapterId}. {lastReadChapter.nameSimple}</strong>
                  <small>({lastReadChapter.translatedName})</small>
                </>
              ) : (
                <strong>Start reading to save your place</strong>
              )}
            </span>
            <span className="learning-last-read-verse">
              {lastRead ? `Verse ${lastRead.verseNumber}` : ""}
              <ChevronIcon />
            </span>
          </span>
        </button>

        <div className="learning-continue-side">
          <div className="learning-continue-card learning-streak-card">
            <button
              type="button"
              className="learning-streak-main"
              onClick={() => setModal("streak")}
              aria-label={`${snapshot.streak} day streak. Open reading streak details.`}
            >
              <SproutIcon />
              <span className="learning-streak-count">{snapshot.streak}</span>
              <span className="learning-streak-label">day streak</span>
              <ChevronIcon />
            </button>

            <button
              type="button"
              className={`learning-goal-button ${goalMet ? "is-met" : ""}`}
              onClick={openGoalModal}
            >
              <TargetIcon />
              <span>
                {goalTarget > 0
                  ? `${Math.min(snapshot.todayCount, goalTarget)}/${goalTarget} today`
                  : "Set a Goal"}
              </span>
            </button>
          </div>

          <button
            type="button"
            className="learning-continue-card learning-my-list"
            onClick={() => setModal("list")}
          >
            <BookmarkIcon />
            <span className="learning-my-list-copy">
              <strong>My List</strong>
              <small>
                {snapshot.list.length
                  ? `${snapshot.list.length} saved ${snapshot.list.length === 1 ? "place" : "places"}`
                  : "Save an Ayah to return to"}
              </small>
            </span>
            <ChevronIcon />
          </button>
        </div>
      </div>

      {listNotice ? <p className="learning-continue-notice" role="status">{listNotice}</p> : null}

      <LearningModal
        open={modal === "navigate"}
        eyebrow="LEARNING BLOCKS"
        title="Navigate Learning"
        onClose={closeModal}
        wide
      >
        <p className="learning-modal-lede">
          Learning Blocks is a reader first: open a Surah and read. Everything below is optional,
          and nothing here is scored or timed.
        </p>
        <div className="learning-guide-sections">
          {NAVIGATE_SECTIONS.map((section, index) => (
            <section className="learning-guide-section" key={section.title}>
              <header>
                <span className="learning-guide-step">{index + 1}</span>
                <div>
                  <h3>{section.title}</h3>
                  <p>{section.body}</p>
                </div>
              </header>
              <div className="learning-guide-body">
                <figure className="learning-guide-figure">
                  <GuideFigure kind={section.figure} />
                </figure>
                <ul>
                  {section.points.map((point) => <li key={point}>{point}</li>)}
                </ul>
              </div>
            </section>
          ))}
        </div>
      </LearningModal>

      <LearningModal
        open={modal === "streak"}
        eyebrow="READING STREAK"
        title={snapshot.streak === 1 ? "1 day streak" : `${snapshot.streak} day streak`}
        onClose={closeModal}
        footer={
          <button type="button" className="learning-modal-secondary" onClick={openGoalModal}>
            {goalTarget > 0 ? "Change daily goal" : "Set a daily goal"}
          </button>
        }
      >
        <p className="learning-modal-lede">
          A day counts once you have read an Ayah in the reader. Your streak stays alive until a
          whole day passes with nothing read.
        </p>

        <div className="learning-streak-strip" aria-label="Reading activity for the last seven days">
          {streakDays.map((day) => (
            <div
              className={`learning-streak-day ${day.active ? "is-active" : ""} ${day.isToday ? "is-today" : ""}`}
              key={day.key}
            >
              <span className="learning-streak-day-dot" aria-hidden="true" />
              <span className="learning-streak-day-label">{day.label}</span>
              <span className="learning-sr-only">
                {day.key}: {day.active ? "read" : "not read"}
              </span>
            </div>
          ))}
        </div>

        <div className="learning-streak-stats">
          <article><strong>{snapshot.streak}</strong><span>Current streak</span></article>
          <article><strong>{snapshot.bestStreak}</strong><span>Best streak</span></article>
          <article><strong>{snapshot.days.length}</strong><span>Days read</span></article>
          <article><strong>{snapshot.todayCount}</strong><span>Ayahs today</span></article>
        </div>

        {goalTarget > 0 ? (
          <div className="learning-goal-progress">
            <div className="learning-goal-progress-head">
              <strong>{goalMet ? "Daily goal met" : "Daily goal"}</strong>
              <span>{Math.min(snapshot.todayCount, goalTarget)} / {goalTarget} Ayahs</span>
            </div>
            <div
              className={`learning-goal-bar ${goalMet ? "is-met" : ""}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={goalTarget}
              aria-valuenow={Math.min(snapshot.todayCount, goalTarget)}
              aria-label="Daily Ayah goal progress"
            >
              <i style={{ width: `${goalPercent}%` }} />
            </div>
          </div>
        ) : null}

        <NotificationSettings streak={snapshot.streak} lastReadDay={lastDayRead} />
      </LearningModal>

      <LearningModal
        open={modal === "goal"}
        eyebrow="DAILY GOAL"
        title="Set a Goal"
        onClose={closeModal}
        footer={
          <>
            {snapshot.goal ? (
              <button
                type="button"
                className="learning-modal-secondary"
                onClick={() => { clearLearningGoal(); closeModal(); }}
              >
                Remove goal
              </button>
            ) : null}
            <button
              type="button"
              className="learning-modal-primary"
              onClick={() => { setLearningGoal(Number(goalDraft)); closeModal(); }}
            >
              Save goal
            </button>
          </>
        }
      >
        <p className="learning-modal-lede">
          Choose how many Ayahs you want to read each day. Progress counts each distinct Ayah you
          read through, and resets at midnight.
        </p>

        <div className="learning-goal-presets" role="group" aria-label="Preset daily goals">
          {GOAL_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset}
              className={Number(goalDraft) === preset ? "is-active" : ""}
              onClick={() => setGoalDraft(String(preset))}
            >
              {preset} <small>Ayahs</small>
            </button>
          ))}
        </div>

        <label className="learning-goal-custom">
          <span>Custom daily goal</span>
          <input
            type="number"
            inputMode="numeric"
            min={MIN_DAILY_AYAH_GOAL}
            max={MAX_DAILY_AYAH_GOAL}
            value={goalDraft}
            onChange={(event) => setGoalDraft(event.target.value.replace(/\D/g, "").slice(0, 3))}
            onBlur={() => setGoalDraft(String(clampGoal(Number(goalDraft))))}
          />
          <small>Between {MIN_DAILY_AYAH_GOAL} and {MAX_DAILY_AYAH_GOAL} Ayahs a day.</small>
        </label>
      </LearningModal>

      <LearningModal
        open={modal === "list"}
        eyebrow="MY LIST"
        title="My List"
        onClose={closeModal}
        footer={
          <>
            {snapshot.list.length ? (
              <button
                type="button"
                className="learning-modal-secondary"
                onClick={() => { clearLearningList(); showListNotice("My List cleared."); }}
              >
                Clear list
              </button>
            ) : null}
            <button
              type="button"
              className="learning-modal-primary"
              disabled={currentIsSaved || snapshot.list.length >= MAX_LIST_ITEMS}
              onClick={saveCurrentPosition}
            >
              {currentIsSaved ? "Current place saved" : "Save current place"}
            </button>
          </>
        }
      >
        <p className="learning-modal-lede">
          Bookmark a Surah from the reader header, or tap an Ayah&rsquo;s medallion to save that
          one Ayah. Tapping an entry here takes you straight back to it.
        </p>

        {snapshot.list.length ? (
          <ul className="learning-list-rows">{snapshot.list.map(renderListRow)}</ul>
        ) : (
          <div className="learning-list-empty">
            <BookmarkIcon />
            <strong>Nothing saved yet</strong>
            <span>Use Save current place to add the Ayah you are reading now.</span>
          </div>
        )}

        {snapshot.list.length >= MAX_LIST_ITEMS ? (
          <p className="learning-list-limit" role="status">
            My List holds {MAX_LIST_ITEMS} places. Remove one to save another.
          </p>
        ) : null}
      </LearningModal>
    </div>
  );
}
