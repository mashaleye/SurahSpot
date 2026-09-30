"use client";

import { FormEvent, type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandLockup } from "./BrandLockup";
import { ModesMenu } from "./ModesMenu";
import { SiteHeader } from "./site/SiteHeader";
import { SiteFooter } from "./site/SiteFooter";
import { AyahCountBoard, type AyahSurahDisplay } from "./AyahCountBoard";
import { CompletionBoard, type CompletionFeedback, type CompletionRoundData } from "./CompletionBoard";
import { ResultShareActions } from "./share/ResultShareActions";
import { VerseShareActions } from "./share/VerseShareActions";
import { DEFAULT_MODE_ID, getMode, getVariant, isModeId, type ModeId } from "@/lib/game/modes";
import { useMediaSession } from "@/lib/pwa/media-session";
import {
  EMPTY_KARAOKE,
  type KaraokeState,
  type Segment,
  karaokeStatesMatch,
  resolveKaraokeState,
} from "@/lib/quran/karaoke";
import {
  MAX_ATTEMPT_HINTS,
  MAX_ATTEMPT_ROUNDS,
  MAX_TRIES_PER_ROUND,
  SECOND_HINT_COST,
  scoreLadder,
} from "@/lib/game/rules";
import { classifySetupError } from "@/lib/game/setup-error";

type Chapter = {
  id: number;
  nameSimple: string;
  nameComplex: string;
  nameArabic: string;
  translatedName: string;
  versesCount: number;
};

type Language = {
  id: string;
  label: string;
  available: boolean;
  translationId: number | null;
  translationName: string | null;
  authorName: string | null;
};

type Reciter = { id: number; name: string; style: string | null; qirat: string | null };

type Config = {
  chapters: Chapter[];
  languages: Language[];
  reciters: Reciter[];
  playableChapterCount?: number;
  attempt?: {
    roundsCompleted: number;
    roundsRemaining: number;
    complete: boolean;
    mode?: ModeId;
    variant?: string;
  } | null;
};

type HintType = "meaning" | "ayah_count" | "juz" | "revelation_place";
type HintReveal = { type: HintType; label: string; value: string };
type HintStatus = { hintsUsed: number; hintsRemaining: number; nextHintCost: number | null };

const HINT_OPTIONS: Array<{ type: HintType; label: string; detail: string }> = [
  { type: "meaning", label: "Meaning of the name", detail: "What the Surah name means" },
  { type: "ayah_count", label: "Number of Ayahs", detail: "How many Ayahs are in the Surah" },
  { type: "juz", label: "Juz / place in the Qur'an", detail: "Which Juz contains this Ayah" },
  { type: "revelation_place", label: "Makkah or Madinah", detail: "Makki or Madani revelation" },
];

type CompletionSurahDisplay = {
  id: number;
  nameSimple: string;
  nameArabic: string;
  translatedName: string;
  versesCount: number;
};

type Round = {
  token: string;
  /** Which mode produced this round. Absent means the default Surah game. */
  mode?: ModeId;
  variant?: string;
  /** Ayah Counts / Completion: the Surah is the prompt, so it is sent in full. */
  surah?: AyahSurahDisplay | CompletionSurahDisplay;
  /** Completion: visible prompt block and shuffled Ayah bank. */
  completion?: CompletionRoundData;
  // Everything below is Identify-the-Surah or Completion audio content.
  words?: Array<{ index: number; position: number; arabic: string }>;
  arabic?: string;
  transliteration?: string;
  translation?: string;
  translationMeta?: { language: string; resourceId: number; name: string; author: string };
  audio?: {
    url: string;
    fromMs: number;
    toMs: number;
    segments: Segment[];
    reciter: string;
    reciterId: number;
    requestedReciterId?: number;
    usedFallbackReciter?: boolean;
  };
  attemptsRemaining: number;
  pointsRemaining: number;
  hints?: HintStatus;
};

/** A round from a mode that plays a recitation. */
type SurahRound = Round & {
  words: NonNullable<Round["words"]>;
  audio: NonNullable<Round["audio"]>;
  translationMeta: NonNullable<Round["translationMeta"]>;
};

type Reveal = {
  verseKey?: string;
  /** Ayah Counts: the answer the player was hunting. */
  versesCount?: number;
  chapterId: number;
  nameSimple: string;
  nameArabic: string;
  translatedName: string;
};

type Stats = { total: number; rounds: number; correct: number; streak: number; bestStreak: number };

type ThemeMode = "system" | "light" | "dark";

const EMPTY_STATS: Stats = { total: 0, rounds: 0, correct: 0, streak: 0, bestStreak: 0 };
// Re-exported under the old local name so the JSX below reads unchanged, but
// sourced from lib/game/rules so the UI can never disagree with the server.
const MAX_ROUNDS = MAX_ATTEMPT_ROUNDS;
const STATS_STORAGE_KEY = "surahspot:stats";
const LEGACY_STATS_STORAGE_KEY = "ayahspot:stats";
const LANGUAGE_STORAGE_KEY = "surahspot:language";
const LEGACY_LANGUAGE_STORAGE_KEY = "ayahspot:language";
const USED_CHAPTERS_STORAGE_KEY = "surahspot:used-chapters";
const VOLUME_STORAGE_KEY = "surahspot:volume";
const RATE_STORAGE_KEY = "surahspot:rate";
const THEME_STORAGE_KEY = "surahspot:theme";
const MODE_STORAGE_KEY = "surahspot:mode";
const VARIANT_STORAGE_KEY = "surahspot:variant";
const HADITH_FOOTER = "The best among you (Muslims) are those who learn the Qur'an and teach it.";
const RTL_LANGUAGES = new Set(["arabic", "dari", "divehi", "hebrew", "kurdish", "pashto", "persian", "sindhi", "uighur, uyghur", "urdu"]);

function Icon({ name, size = 20 }: { name: "play" | "pause" | "volume" | "refresh" | "settings" | "chevron" | "spark" | "headphones" | "check" | "x" | "skip" | "fastForward" | "hint"; size?: number }) {
  const paths: Record<string, ReactNode> = {
    play: <path d="m8 5 11 7-11 7V5Z" />,
    pause: <><path d="M9 5v14" /><path d="M15 5v14" /></>,
    volume: <><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15 9a4 4 0 0 1 0 6" /><path d="M17.5 6.5a8 8 0 0 1 0 11" /></>,
    refresh: <><path d="M20 6v5h-5" /><path d="M20 11a8 8 0 1 0-2.35 5.65" /></>,
    settings: <><circle cx="12" cy="12" r="3.4" /><path d="M9.42 5.28L9.19 2.82A9.6 9.6 0 0 1 14.81 2.82L14.58 5.28A7.2 7.2 0 0 1 16.53 6.4L18.55 4.98A9.6 9.6 0 0 1 21.35 9.84L19.11 10.87A7.2 7.2 0 0 1 19.11 13.13L21.35 14.16A9.6 9.6 0 0 1 18.55 19.02L16.53 17.6A7.2 7.2 0 0 1 14.58 18.72L14.81 21.18A9.6 9.6 0 0 1 9.19 21.18L9.42 18.72A7.2 7.2 0 0 1 7.47 17.6L5.45 19.02A9.6 9.6 0 0 1 2.65 14.16L4.89 13.13A7.2 7.2 0 0 1 4.89 10.87L2.65 9.84A9.6 9.6 0 0 1 5.45 4.98L7.47 6.4Z" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    spark: <path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Zm6 12 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z" />,
    headphones: <><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><path d="M18 19h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5a2 2 0 0 1-2 2ZM6 19H5a2 2 0 0 1-2-2v-5h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2Z" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    x: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
    skip: <><path d="m5 5 10 7L5 19V5Z" /><path d="M19 5v14" /></>,
    fastForward: <><path d="m3.5 6 7 6-7 6V6Z" /><path d="m11.5 6 7 6-7 6V6Z" /></>,
    hint: <><path d="M9 18h6" /><path d="M10 22h4" /><path d="M8.4 14.5A6 6 0 1 1 15.6 14.5C14.6 15.2 14 16.1 14 17h-4c0-.9-.6-1.8-1.6-2.5Z" /></>,
  };
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function RubElHizbPattern() {
  return (
    <svg className="summary-ornament" viewBox="0 0 320 320" aria-hidden="true">
      <defs>
        <pattern id="rub-pattern" width="64" height="64" patternUnits="userSpaceOnUse">
          <g transform="translate(32 32)" fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.9">
            <rect x="-12" y="-12" width="24" height="24" rx="1.5" />
            <rect x="-12" y="-12" width="24" height="24" rx="1.5" transform="rotate(45)" />
            <circle r="3.4" fill="currentColor" stroke="none" opacity="0.55" />
          </g>
        </pattern>
      </defs>
      <rect width="320" height="320" fill="url(#rub-pattern)" />
    </svg>
  );
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

/**
 * Accepts anything, because it is mapped over an alias list.
 *
 * `filteredChapters` builds six aliases per chapter and maps this over all of
 * them. Typed as `string`, this threw on the first absent field — a fixture
 * without `name_complex` reached the client as undefined, `.toLowerCase()`
 * threw inside the map, and because the throw happened during render the whole
 * board was replaced by "a client-side exception". Every e2e project failed,
 * and the visible symptom was an empty page rather than a missing name.
 *
 * The routes now supply a fallback, so this should never see a non-string
 * again. It stays tolerant anyway: one missing field out of six should degrade
 * that chapter's searchability, not take the app down.
 */
function normalizeSearch(value: string | null | undefined) {
  if (typeof value !== "string") return "";

  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^surah\s+/, "")
    .replace(/[’'`._-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function QuranGuessGame() {
  const [config, setConfig] = useState<Config | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  /**
   * Active mode and play style.
   *
   * Persisted so a returning player lands back in the game they were playing.
   * The server re-resolves whatever arrives through getMode(), so a stale or
   * edited value drops to the default rather than breaking the board.
   */
  const [modeId, setModeId] = useState<ModeId>(DEFAULT_MODE_ID);
  const [variantId, setVariantId] = useState<string | undefined>(undefined);
  /** Per-round feedback for Ayah Counts. Cleared whenever a round starts. */
  const [ayahFeedback, setAyahFeedback] = useState<{
    direction?: "higher" | "lower" | "exact";
    lastGuessScore?: number;
    tryScores?: number[];
  }>({});
  const [completionFeedback, setCompletionFeedback] = useState<CompletionFeedback>(null);
  const completionFeedbackNonce = useRef(0);
  const [loading, setLoading] = useState(true);
  const [modeSwitching, setModeSwitching] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"playing" | "won" | "lost">("playing");
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState("english");
  const [selectedReciterId, setSelectedReciterId] = useState<number | undefined>();
  const [guessText, setGuessText] = useState("");
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [qfSearchResults, setQfSearchResults] = useState<Chapter[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  /*
   * Whether the element is waiting on the network rather than playing.
   *
   * Without this the play button looks identical while a chapter file is
   * being fetched and while nothing is happening, so a slow start reads as a
   * dead button — the player taps again, which pauses it, and the recitation
   * appears to come on late for no reason.
   */
  const [buffering, setBuffering] = useState(false);
  const [volume, setVolume] = useState(0.82);
  const [rate, setRate] = useState(1);
  const [karaoke, setKaraoke] = useState<KaraokeState>(EMPTY_KARAOKE);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [attemptComplete, setAttemptComplete] = useState(false);
  const [usedChapterIds, setUsedChapterIds] = useState<number[]>([]);
  const [hintMenuOpen, setHintMenuOpen] = useState(false);
  const [hintLoading, setHintLoading] = useState(false);
  const [revealedHints, setRevealedHints] = useState<HintReveal[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const autocompleteRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastVisualSyncRef = useRef(0);

  const persistStats = useCallback((next: Stats) => {
    setStats(next);
    localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(next));
    localStorage.setItem(LEGACY_STATS_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const persistUsedChapterIds = useCallback((ids: number[]) => {
    const normalized = Array.from(new Set(ids))
      .filter((id) => Number.isInteger(id) && id >= 1 && id <= 114)
      .slice(-MAX_ROUNDS);
    setUsedChapterIds(normalized);
    localStorage.setItem(USED_CHAPTERS_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }, []);

  /**
   * Align the locally displayed round counter with the server's count.
   *
   * The stats object drives the visible "Round N of 7" and the exclusion list,
   * and it lives in localStorage where it can be cleared by a privacy mode,
   * lost on a new device, or edited by hand. The server tracks the same number
   * behind an HttpOnly cookie and will refuse an eighth round regardless — so
   * when they differ, the server wins and the UI stops showing a number the
   * player cannot act on.
   */
  const reconcileProgress = useCallback((progress: { roundsCompleted: number; complete: boolean }) => {
    setStats((previous) => {
      if (previous.rounds === progress.roundsCompleted) return previous;
      const next = { ...previous, rounds: Math.min(MAX_ROUNDS, progress.roundsCompleted) };
      try {
        localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage can be unavailable; the in-memory correction still applies.
      }
      return next;
    });
    setAttemptComplete(progress.complete);
  }, []);

  const newRound = useCallback(async (
    language = selectedLanguage,
    reciterId = selectedReciterId,
    excludeChapterIds = usedChapterIds,
    newAttempt = false,
    requestedMode: ModeId = modeId,
    requestedVariant: string | undefined = variantId,
    resetReason?: "mode-switch" | "challenge",
  ) => {
    setLoading(true);
    setMessage("");
    setReveal(null);
    setStatus("playing");
    setGuessText("");
    setSelectedChapter(null);
    setSuggestionsOpen(false);
    setQfSearchResults(null);
    setHintMenuOpen(false);
    setRevealedHints([]);
    setKaraoke(EMPTY_KARAOKE);
    setIsPlaying(false);
    setCurrentTime(0);
    setAyahFeedback({});
    setCompletionFeedback(null);
    try {
      const response = await fetch("/api/quran/round", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language,
          reciterId,
          excludeChapterIds,
          newAttempt,
          mode: requestedMode,
          variant: requestedVariant,
          resetReason,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start a round.");
      setRound(data);

      // Trust the normalized values echoed by the server, not a stale saved
      // preference. This also makes variant fallbacks (e.g. an old id) safe.
      const resolvedMode = getMode(data.mode);
      const resolvedVariant = getVariant(resolvedMode, data.variant)?.id;
      setModeId(resolvedMode.id);
      setVariantId(resolvedVariant);
      try {
        localStorage.setItem(MODE_STORAGE_KEY, resolvedMode.id);
        if (resolvedVariant) localStorage.setItem(VARIANT_STORAGE_KEY, resolvedVariant);
        else localStorage.removeItem(VARIANT_STORAGE_KEY);
      } catch {
        // The current session still works when storage is unavailable.
      }

      setSetupError("");
      // The server is the authority on how far the attempt has gone. A cleared
      // or edited localStorage counter is corrected here rather than being
      // allowed to disagree with what the server will actually permit.
      if (data.progress) reconcileProgress(data.progress);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Could not start a round.";
      setSetupError(errorMessage);
      setMessage(errorMessage);
      return false;
    } finally {
      setLoading(false);
    }
  }, [selectedLanguage, selectedReciterId, usedChapterIds, reconcileProgress, modeId, variantId]);

  const startNewAttempt = useCallback(async () => {
    audioRef.current?.pause();
    const reset = { ...EMPTY_STATS };
    persistStats(reset);
    persistUsedChapterIds([]);
    setAttemptComplete(false);
    setSummaryOpen(false);
    setCurrentTime(0);
    await newRound(selectedLanguage, selectedReciterId, [], true);
  }, [newRound, persistStats, persistUsedChapterIds, selectedLanguage, selectedReciterId]);

  const switchGameMode = useCallback(async (nextMode: ModeId, nextVariant?: string) => {
    // Do not let an older round/guess/hint response race a mode switch and
    // repaint the board with stale rules after the switch completes.
    if (
      modeSwitching ||
      loading ||
      submitting ||
      hintLoading ||
      (nextMode === modeId && nextVariant === variantId)
    ) return;

    audioRef.current?.pause();
    setModeSwitching(true);
    setSummaryOpen(false);

    const switched = await newRound(
      selectedLanguage,
      selectedReciterId,
      [],
      true,
      nextMode,
      nextVariant,
      "mode-switch",
    );

    if (switched) {
      // Reset persistent as well as in-memory attempt state. The previous
      // implementation only changed React state, so a refresh resurrected the
      // old score after switching modes.
      persistStats({ ...EMPTY_STATS });
      persistUsedChapterIds([]);
      setAttemptComplete(false);
    }

    setModeSwitching(false);
  }, [
    modeSwitching,
    loading,
    submitting,
    hintLoading,
    modeId,
    variantId,
    newRound,
    persistStats,
    persistUsedChapterIds,
    selectedLanguage,
    selectedReciterId,
  ]);

  useEffect(() => {
    let initialStats = EMPTY_STATS;
    const storedStats = localStorage.getItem(STATS_STORAGE_KEY) ?? localStorage.getItem(LEGACY_STATS_STORAGE_KEY);
    if (storedStats) {
      try {
        initialStats = { ...EMPTY_STATS, ...JSON.parse(storedStats) };
        setStats(initialStats);
      } catch {
        initialStats = EMPTY_STATS;
      }
    }

    let initialUsedChapterIds: number[] = [];
    const storedUsedChapterIds = localStorage.getItem(USED_CHAPTERS_STORAGE_KEY);
    if (initialStats.rounds > 0 && initialStats.rounds < MAX_ROUNDS && storedUsedChapterIds) {
      try {
        const parsed = JSON.parse(storedUsedChapterIds);
        if (Array.isArray(parsed)) {
          initialUsedChapterIds = Array.from(new Set(parsed.map(Number)))
            .filter((id) => Number.isInteger(id) && id >= 1 && id <= 114)
            .slice(-MAX_ROUNDS);
        }
      } catch {
        initialUsedChapterIds = [];
      }
    }
    setUsedChapterIds(initialUsedChapterIds);

    const storedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY) ?? "english";
    setSelectedLanguage(storedLanguage);

    const urlParams = new URLSearchParams(window.location.search);
    const challengeRequested = urlParams.get("challenge") === "1";
    /*
     * A mode named in the URL on its own, as `/?mode=completion&variant=sequence`,
     * is how a reminder opens the game. It means "play these rules": an
     * attempt already under way under them simply continues, one under
     * different rules is replaced, and a finished one gives way to a fresh
     * one — the same as choosing the mode from the Modes menu, except that a
     * same-rules attempt in progress is kept rather than restarted.
     */
    const modeRequested = !challengeRequested && isModeId(urlParams.get("mode"));
    const preferredMode = challengeRequested || modeRequested
      ? getMode(urlParams.get("mode"))
      : getMode(localStorage.getItem(MODE_STORAGE_KEY));
    const preferredVariant = getVariant(
      preferredMode,
      challengeRequested || modeRequested
        ? urlParams.get("variant")
        : localStorage.getItem(VARIANT_STORAGE_KEY),
    )?.id;
    const storedMode = preferredMode;
    const storedVariant = preferredVariant;
    setModeId(storedMode.id);
    setVariantId(storedVariant);

    const alreadyComplete = challengeRequested ? false : initialStats.rounds >= MAX_ROUNDS;
    setAttemptComplete(alreadyComplete);
    setSummaryOpen(alreadyComplete);

    (async () => {
      try {
        const response = await fetch("/api/quran/config", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load Quran resources.");
        setConfig(data);
        const afasy = data.reciters.find((item: Reciter) => /afasy|alafasy/i.test(item.name));
        const reciterId = afasy?.id ?? data.reciters[0]?.id;
        setSelectedReciterId(reciterId);

        if (challengeRequested) {
          // A shared-result challenge is an explicit fresh attempt in the same
          // mode, never the same answers. Reset local presentation state and
          // ask the server for a new authoritative attempt.
          persistStats({ ...EMPTY_STATS });
          persistUsedChapterIds([]);
          setAttemptComplete(false);
          setSummaryOpen(false);
          await newRound(
            storedLanguage,
            reciterId,
            [],
            true,
            storedMode.id,
            storedVariant,
            "challenge",
          );
          window.history.replaceState({}, "", "/");
        } else {
          // The server owns the active attempt, including its mode. This matters
          // after a refresh where localStorage may have been cleared or may still
          // contain a preference from a previous attempt.
          const activeMode = getMode(data.attempt?.mode ?? storedMode.id);
          const activeVariant = getVariant(activeMode, data.attempt?.variant ?? storedVariant)?.id;
          const isComplete = data.attempt?.complete ?? alreadyComplete;
          const rulesDiffer = activeMode.id !== storedMode.id || activeVariant !== storedVariant;

          if (modeRequested && (rulesDiffer || isComplete)) {
            // The requested rules are not what is in play: start fresh under
            // them. A live attempt under other rules needs the same explicit
            // reset a Modes-menu switch sends; a finished one needs none.
            persistStats({ ...EMPTY_STATS });
            persistUsedChapterIds([]);
            setAttemptComplete(false);
            setSummaryOpen(false);
            setModeId(storedMode.id);
            setVariantId(storedVariant);
            await newRound(
              storedLanguage,
              reciterId,
              [],
              true,
              storedMode.id,
              storedVariant,
              rulesDiffer && !isComplete ? "mode-switch" : undefined,
            );
          } else {
            setModeId(activeMode.id);
            setVariantId(activeVariant);
            if (data.attempt) reconcileProgress(data.attempt);
            setAttemptComplete(isComplete);
            setSummaryOpen(isComplete);
            if (!isComplete) {
              await newRound(
                storedLanguage,
                reciterId,
                initialUsedChapterIds,
                false,
                activeMode.id,
                activeVariant,
              );
            } else {
              setLoading(false);
            }
          }

          // Consumed: a reload should resume the attempt, not re-apply the link.
          if (modeRequested) window.history.replaceState({}, "", "/");
        }
      } catch (error) {
        setSetupError(error instanceof Error ? error.message : "Could not load the app.");
        setLoading(false);
      }
    })();
    // Initial load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Appearance preference is independent from gameplay. "System" follows the
  // browser/OS preference and updates live if the user changes it.
  useEffect(() => {
    try {
      const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (storedTheme === "system" || storedTheme === "light" || storedTheme === "dark") {
        setThemeMode(storedTheme);
      }
    } catch {
      // Privacy modes may disable localStorage; system mode remains the fallback.
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      const resolvedTheme =
        themeMode === "system"
          ? (media.matches ? "dark" : "light")
          : themeMode;

      root.dataset.theme = resolvedTheme;
      root.dataset.themeMode = themeMode;
      root.style.colorScheme = resolvedTheme;
    };

    applyTheme();

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // Theme still works for the current page even when storage is unavailable.
    }

    if (themeMode !== "system") return;

    const handleSystemThemeChange = () => applyTheme();
    media.addEventListener?.("change", handleSystemThemeChange);

    return () => {
      media.removeEventListener?.("change", handleSystemThemeChange);
    };
  }, [themeMode]);

  // Volume and speed are transport preferences; keep them across rounds and
  // sessions like the language and reciter choices.
  useEffect(() => {
    try {
      const storedVolume = Number(window.localStorage.getItem(VOLUME_STORAGE_KEY));
      if (Number.isFinite(storedVolume) && storedVolume >= 0 && storedVolume <= 1) setVolume(storedVolume);
      const storedRate = Number(window.localStorage.getItem(RATE_STORAGE_KEY));
      if ([0.75, 1, 1.25].includes(storedRate)) setRate(storedRate);
    } catch {
      // localStorage can be unavailable in private modes; defaults are fine.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
      window.localStorage.setItem(RATE_STORAGE_KEY, String(rate));
    } catch {
      // Ignore quota or privacy-mode failures.
    }
  }, [volume, rate]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !round) return;
    audio.volume = volume;
    audio.playbackRate = rate;
  }, [volume, rate, round]);

  /**
   * Move the element to the start of this Ayah.
   *
   * Guarded on readyState because assigning currentTime before metadata has
   * loaded is ignored on iOS Safari — silently, so the first play would start
   * at the top of the chapter file instead of at the Ayah.
   */
  const seekToAyahStart = useCallback((audio: HTMLAudioElement) => {
    if (!round?.audio) return;
    const surahRound = round as SurahRound;
    if (audio.readyState < 1) return;
    audio.currentTime = surahRound.audio.fromMs / 1000;
  }, [round]);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !round?.audio || status !== "playing") return;
    const surahRound = round as SurahRound;
    const from = surahRound.audio.fromMs / 1000;
    const to = surahRound.audio.toMs / 1000;
    if (audio.currentTime < from - 0.1 || audio.currentTime >= to - 0.02) seekToAyahStart(audio);
    if (!audio.paused) {
      audio.pause();
      return;
    }
    /*
     * Show the wait from the tap, not from the first `waiting` event. That
     * event only fires once the element has actually run dry, which is after
     * the player has already been looking at an unchanged button.
     */
    if (audio.readyState < 3) setBuffering(true);

    try {
      // play() rejects when the browser blocks playback or the range request
      // for the chapter file has not resolved yet. Surface that instead of
      // leaving an unhandled rejection and a button that looks dead.
      await audio.play();
    } catch {
      setIsPlaying(false);
      setBuffering(false);
      setMessage("Playback could not start. Tap play again once the recitation has buffered.");
    }
  }, [round, status, seekToAyahStart]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      // Space already activates a focused button or link, and typing a space in
      // a field must not toggle audio. Firing here too caused a double action.
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON" || tag === "A") return;
      if (active?.isContentEditable) return;
      if (settingsOpen || summaryOpen) return;
      event.preventDefault();
      void togglePlay();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePlay, settingsOpen, summaryOpen]);

  const filteredChapters = useMemo(() => {
    if (!config) return [];
    const query = normalizeSearch(guessText);
    if (!query) return config.chapters;

    return config.chapters.filter((chapter) => {
      const aliases = [
        chapter.nameSimple,
        chapter.nameComplex,
        chapter.nameArabic,
        chapter.translatedName,
        String(chapter.id),
        `surah ${chapter.id}`,
        `surah ${chapter.nameSimple}`,
      ].map(normalizeSearch);
      return aliases.some((value) => value.includes(query));
    });
  }, [config, guessText]);

  const displayedChapters = useMemo(() => {
    if (!config) return [];
    if (!guessText.trim()) return config.chapters;
    if (!qfSearchResults) return filteredChapters;

    // QF results get priority, while local canonical matching fills in aliases
    // or transliterations that the remote quick index may not rank first.
    const seen = new Set(qfSearchResults.map((chapter) => chapter.id));
    return [
      ...qfSearchResults,
      ...filteredChapters.filter((chapter) => !seen.has(chapter.id)),
    ];
  }, [config, filteredChapters, guessText, qfSearchResults]);

  useEffect(() => {
    if (!suggestionsOpen || status !== "playing") return;

    const query = guessText.trim();
    if (!query) {
      setQfSearchResults(null);
      setSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const response = await fetch(`/api/quran/search?query=${encodeURIComponent(query)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not search Surahs.");
        if (!controller.signal.aborted) setQfSearchResults(Array.isArray(data.surahs) ? data.surahs : []);
      } catch (error) {
        // Keep the canonical local catalog as a graceful fallback if Search is
        // temporarily unavailable. AbortErrors are expected while typing.
        if (!controller.signal.aborted) setQfSearchResults(null);
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [guessText, suggestionsOpen, status]);

  useEffect(() => {
    if (!suggestionsOpen) return;
    const closeOnOutsideInteraction = (event: PointerEvent) => {
      if (!autocompleteRef.current?.contains(event.target as Node)) {
        setSuggestionsOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideInteraction);
    return () => document.removeEventListener("pointerdown", closeOnOutsideInteraction);
  }, [suggestionsOpen]);

  // The settings popover previously had no dismissal other than its own close
  // button, so tapping elsewhere on a phone left it covering the round.
  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnOutsideInteraction = (event: PointerEvent) => {
      const target = event.target as Node;
      if (settingsRef.current?.contains(target)) return;
      if (settingsButtonRef.current?.contains(target)) return;
      setSettingsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSettingsOpen(false);
      settingsButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsideInteraction);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideInteraction);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [settingsOpen]);

  // Escape closes the attempt summary, which is a modal dialog.
  useEffect(() => {
    if (!summaryOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSummaryOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [summaryOpen]);

  // Only shown on a reduced environment (e.g. pre-live); a no-op on production.
  const reducedCatalog = Boolean(
    config?.playableChapterCount && config.playableChapterCount < config.chapters.length,
  );

  /**
   * The current round, narrowed to the mode that actually has audio, words and
   * hints. Ayah Counts rounds carry none of those, so every playback and
   * karaoke path reads from here — which lets the compiler prove those blocks
   * are unreachable in a silent mode rather than relying on optional chaining
   * everywhere and hoping.
   */
  const surahRound: SurahRound | null =
    round && round.audio && round.words && round.translationMeta ? (round as SurahRound) : null;
  const activeModeId = round?.mode ?? modeId;
  const isAyahCounts = activeModeId === "ayah-counts";
  const isCompletion = activeModeId === "completion";
  const isCompletionSequence = isCompletion && (round?.variant ?? variantId) === "sequence";
  const isClosestAyahCounts = isAyahCounts && (round?.variant ?? variantId) === "closest";

  const arabicDensity = !surahRound
    ? ""
    : surahRound.words.length >= 42
      ? "very-dense"
      : surahRound.words.length >= 25
        ? "dense"
        : "";

  const currentRelative = surahRound ? Math.max(0, currentTime - surahRound.audio.fromMs / 1000) : 0;
  const totalDuration = surahRound
    ? Math.max(0, (surahRound.audio.toMs - surahRound.audio.fromMs) / 1000)
    : 0;
  const progress = totalDuration ? Math.min(1, currentRelative / totalDuration) : 0;
  const attemptsUsed = round ? MAX_TRIES_PER_ROUND - round.attemptsRemaining : 0;
  const accuracy = stats.rounds ? Math.round((stats.correct / stats.rounds) * 100) : 0;
  const roundsRemaining = Math.max(0, MAX_ROUNDS - stats.rounds);
  const averageScore = stats.rounds ? Math.round(stats.total / stats.rounds) : 0;
  const displayRoundNumber = round ? Math.max(1, Math.min(MAX_ROUNDS, stats.rounds + (status === "playing" ? 1 : 0))) : Math.min(MAX_ROUNDS, Math.max(1, stats.rounds || 1));

  const syncPlaybackVisuals = useCallback((force = false) => {
    const audio = audioRef.current;
    // Silent modes have no element and no timing, so there is nothing to sync.
    if (!audio || !round?.audio) return;
    const surahRound = round as SurahRound;

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    // ~30 visual updates/second is smooth enough for the per-word fill without
    // forcing the entire React tree to render at the display's full refresh rate.
    if (!force && now - lastVisualSyncRef.current < 32) return;
    lastVisualSyncRef.current = now;

    const fromSeconds = surahRound.audio.fromMs / 1000;
    const toSeconds = surahRound.audio.toMs / 1000;
    let playbackSeconds = audio.currentTime;

    if (playbackSeconds < fromSeconds) playbackSeconds = fromSeconds;
    if (playbackSeconds >= toSeconds) {
      playbackSeconds = toSeconds;
      if (!audio.paused) audio.pause();
    }

    setCurrentTime(playbackSeconds);
    const next = resolveKaraokeState(surahRound.audio.segments, playbackSeconds * 1000);
    // Returning the previous object when nothing visible changed is what keeps
    // React from re-rendering the whole ayah on every animation frame.
    setKaraoke((previous) => (karaokeStatesMatch(previous, next) ? previous : next));
  }, [round]);

  useEffect(() => {
    if (!isPlaying || !round) return;

    const frame = () => {
      syncPlaybackVisuals();
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        animationFrameRef.current = window.requestAnimationFrame(frame);
      }
    };

    animationFrameRef.current = window.requestAnimationFrame(frame);
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, round, syncPlaybackVisuals]);

  /**
   * Re-sync the highlight after the page was backgrounded.
   *
   * Phones suspend timers and animation frames when the screen locks or the
   * user switches apps, and iOS additionally pauses media. On return, the
   * highlight would otherwise sit wherever the last frame left it while the
   * audio had moved on — or stopped. Reading audio.currentTime directly puts
   * the two back in agreement in one step.
   */
  useEffect(() => {
    const resync = () => {
      const audio = audioRef.current;
      if (!audio) return;
      setIsPlaying(!audio.paused);
      syncPlaybackVisuals(true);
    };

    document.addEventListener("visibilitychange", resync);
    // pageshow fires when Safari restores the page from the back/forward
    // cache, where no other lifecycle event does.
    window.addEventListener("pageshow", resync);
    return () => {
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("pageshow", resync);
    };
  }, [syncPlaybackVisuals]);

  const seek = (ratio: number) => {
    const audio = audioRef.current;
    if (!audio || !round?.audio) return;
    const next = round.audio.fromMs / 1000 + totalDuration * ratio;
    audio.currentTime = Math.min(round.audio.toMs / 1000 - 0.02, Math.max(round.audio.fromMs / 1000, next));
    syncPlaybackVisuals(true);
  };

  /*
   * Lock-screen and headphone controls.
   *
   * The title is the one thing here that needs care. Anything the OS shows
   * sits outside this app's reveal logic, so naming the Surah while it is
   * still the answer would hand it to the player from the notification
   * shade — or from a car stereo. The name is only passed once the round is
   * over; until then the reciter carries the metadata, which gives the
   * player nothing they do not already hear.
   */
  const roundIsOver = status !== "playing";
  const mediaTitle = roundIsOver && reveal
    ? `${reveal.nameSimple} · Ayah ${reveal.verseKey?.split(":")[1] ?? ""}`.trim()
    : "SurahSpot recitation";

  const mediaSeek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !round?.audio) return;
    const from = round.audio.fromMs / 1000;
    const to = round.audio.toMs / 1000;
    /*
     * The OS scrubber was told this track is one Ayah long, so the time it
     * hands back is measured from the start of the Ayah — not from the start
     * of the chapter file the element is actually playing. Offsetting by the
     * Ayah's start is what keeps the two in agreement.
     */
    audio.currentTime = Math.min(to - 0.02, Math.max(from, from + seconds));
    syncPlaybackVisuals(true);
  }, [round, syncPlaybackVisuals]);

  const mediaPlay = useCallback(() => { void audioRef.current?.play().catch(() => {}); }, []);
  const mediaPause = useCallback(() => { audioRef.current?.pause(); }, []);

  useMediaSession({
    active: Boolean(surahRound),
    playing: isPlaying,
    title: mediaTitle,
    artist: surahRound?.audio.reciter,
    duration: totalDuration || undefined,
    /*
     * Quantized to whole seconds on purpose. The karaoke highlight updates
     * about thirty times a second, and handing every one of those to
     * setPositionState would cross into the browser's media process at the
     * same rate. The OS interpolates between updates from the playback rate,
     * so a second's granularity looks identical on the lock screen.
     */
    position: Math.floor(currentRelative),
    playbackRate: rate,
    onPlay: mediaPlay,
    onPause: mediaPause,
    onSeek: mediaSeek,
    onStop: mediaPause,
  });

  const submitGuess = async (event?: FormEvent, skip = false, ayahCount?: number) => {
    event?.preventDefault();
    if (!round || submitting || status !== "playing") return;
    // Ayah Counts validates its own input in the board component; the Surah
    // game needs a chapter picked from the suggestions.
    if (!skip && !isAyahCounts && !selectedChapter) {
      setMessage("Choose a Surah from the suggestions first.");
      setSuggestionsOpen(true);
      return;
    }

    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/game/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: round.token,
          chapterId: selectedChapter?.id,
          ayahCount,
          skip,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not check the guess.");

      // Ayah Counts feedback. Direction turns five stabs into a convergence;
      // the per-try scores show which guess is carrying the round under
      // best-of scoring.
      if (isAyahCounts) {
        setAyahFeedback({
          direction: data.direction,
          lastGuessScore: data.lastGuessScore,
          tryScores: data.tryScores,
        });
      }

      if (data.correct) {
        audioRef.current?.pause();
        setStatus("won");
        setReveal(data.reveal);
        setRound((previous) => previous ? { ...previous, pointsRemaining: data.points } : previous);
        setMessage(`Correct — +${data.points} points`);
        const next = {
          total: stats.total + data.points,
          rounds: stats.rounds + 1,
          correct: stats.correct + 1,
          streak: stats.streak + 1,
          bestStreak: Math.max(stats.bestStreak, stats.streak + 1),
        };
        persistStats(next);
        persistUsedChapterIds([...usedChapterIds, data.reveal.chapterId]);
        if (next.rounds >= MAX_ROUNDS) {
          setAttemptComplete(true);
          setSummaryOpen(true);
        }
      } else if (data.exhausted) {
        audioRef.current?.pause();
        setStatus("lost");
        setReveal(data.reveal);

        // Closest Figure can legitimately earn points without landing on the
        // exact count. The server returns that best-of score on the fifth try;
        // keep it instead of treating every non-exact finish as a zero.
        const awardedPoints = Number.isFinite(Number(data.points)) ? Number(data.points) : 0;
        setRound((previous) => previous ? {
          ...previous,
          attemptsRemaining: 0,
          pointsRemaining: awardedPoints,
        } : previous);
        setMessage(
          isAyahCounts && round.variant === "closest" && awardedPoints > 0
            ? `Round over — your best estimate earned ${awardedPoints} points.`
            : "Round over — the answer is revealed below.",
        );
        const next = {
          ...stats,
          total: stats.total + awardedPoints,
          rounds: stats.rounds + 1,
          streak: 0,
        };
        persistStats(next);
        persistUsedChapterIds([...usedChapterIds, data.reveal.chapterId]);
        if (next.rounds >= MAX_ROUNDS) {
          setAttemptComplete(true);
          setSummaryOpen(true);
        }
      } else {
        setRound((previous) => previous ? {
          ...previous,
          token: data.token,
          attemptsRemaining: data.attemptsRemaining,
          pointsRemaining: data.pointsRemaining,
        } : previous);
        setMessage(skip ? `Skipped. ${data.attemptsRemaining} tries left.` : `Not quite. ${data.attemptsRemaining} tries left.`);
        setGuessText("");
        setSelectedChapter(null);
        setSuggestionsOpen(false);
        setQfSearchResults(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not check the guess.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitCompletion = async (
    answer: { choiceId?: string; order?: string[] } = {},
    skip = false,
  ) => {
    if (!round || !isCompletion || submitting || status !== "playing") return;

    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/game/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: round.token,
          completionChoiceId: answer.choiceId,
          completionOrder: answer.order,
          skip,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not check the completion.");

      completionFeedbackNonce.current += 1;
      setCompletionFeedback({
        correctPositions: data.correctPositions,
        correctChoiceIds: data.correctChoiceIds,
        nonce: completionFeedbackNonce.current,
      });

      if (data.correct) {
        audioRef.current?.pause();
        setStatus("won");
        setReveal(data.reveal);
        setRound((previous) => previous ? { ...previous, pointsRemaining: data.points } : previous);
        setMessage(`Completed — +${data.points} points`);
        const next = {
          total: stats.total + data.points,
          rounds: stats.rounds + 1,
          correct: stats.correct + 1,
          streak: stats.streak + 1,
          bestStreak: Math.max(stats.bestStreak, stats.streak + 1),
        };
        persistStats(next);
        persistUsedChapterIds([...usedChapterIds, data.reveal.chapterId]);
        if (next.rounds >= MAX_ROUNDS) {
          setAttemptComplete(true);
          setSummaryOpen(true);
        }
      } else if (data.exhausted) {
        audioRef.current?.pause();
        setStatus("lost");
        setReveal(data.reveal);
        setRound((previous) => previous ? { ...previous, attemptsRemaining: 0, pointsRemaining: 0 } : previous);
        setMessage("Round over — the correct completion is shown in the blanks.");
        const next = { ...stats, rounds: stats.rounds + 1, streak: 0 };
        persistStats(next);
        persistUsedChapterIds([...usedChapterIds, data.reveal.chapterId]);
        if (next.rounds >= MAX_ROUNDS) {
          setAttemptComplete(true);
          setSummaryOpen(true);
        }
      } else {
        setRound((previous) => previous ? {
          ...previous,
          token: data.token,
          attemptsRemaining: data.attemptsRemaining,
          pointsRemaining: data.pointsRemaining,
        } : previous);
        const lockedCount = Array.isArray(data.correctPositions)
          ? data.correctPositions.filter(Boolean).length
          : 0;
        setMessage(
          skip
            ? `Skipped. ${data.attemptsRemaining} tries left.`
            : isCompletionSequence && lockedCount > 0
              ? `${lockedCount} ${lockedCount === 1 ? "Ayah is" : "Ayahs are"} in the correct position. ${data.attemptsRemaining} tries left.`
              : `Not quite. ${data.attemptsRemaining} tries left.`,
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not check the completion.");
    } finally {
      setSubmitting(false);
    }
  };

  const skipCurrentRound = async () => {
    if (!round || submitting || status !== "playing") return;

    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/game/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: round.token, skipRound: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not skip this round.");

      audioRef.current?.pause();
      if (isCompletion && Array.isArray(data.correctChoiceIds) && data.correctChoiceIds.length > 0) {
        completionFeedbackNonce.current += 1;
        setCompletionFeedback({
          correctChoiceIds: data.correctChoiceIds,
          correctPositions: Array.isArray(data.correctPositions) ? data.correctPositions : undefined,
          nonce: completionFeedbackNonce.current,
        });
      }
      const nextUsedChapterIds = persistUsedChapterIds([...usedChapterIds, data.reveal.chapterId]);
      const nextStats = { ...stats, rounds: stats.rounds + 1, streak: 0 };
      persistStats(nextStats);

      if (nextStats.rounds >= MAX_ROUNDS) {
        setStatus("lost");
        setReveal(data.reveal);
        setRound((previous) => previous ? { ...previous, attemptsRemaining: 0, pointsRemaining: 0 } : previous);
        setMessage("Round skipped — 0 points.");
        setAttemptComplete(true);
        setSummaryOpen(true);
      } else {
        await newRound(selectedLanguage, selectedReciterId, nextUsedChapterIds);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not skip this round.");
    } finally {
      setSubmitting(false);
    }
  };

  const requestHint = async (type: HintType) => {
    // Hints exist only where the Surah is hidden; the server rejects them in
    // other modes, and the control is not rendered there either.
    if (!round?.hints || hintLoading || submitting || status !== "playing" || round.hints.hintsRemaining <= 0) return;

    setHintLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/game/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: round.token, type }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not reveal this hint.");

      setRound((previous) => previous ? {
        ...previous,
        token: data.token,
        pointsRemaining: data.pointsRemaining,
        hints: {
          hintsUsed: data.hintsUsed,
          hintsRemaining: data.hintsRemaining,
          nextHintCost: data.nextHintCost,
        },
      } : previous);
      setRevealedHints((previous) => [...previous, data.hint]);
      setHintMenuOpen(false);
      setMessage(data.cost === 0
        ? "Hint revealed \u2014 your first hint is free."
        : `Hint revealed \u2014 ${data.cost} points deducted from this round.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reveal this hint.");
    } finally {
      setHintLoading(false);
    }
  };

  const changeLanguage = async (language: string) => {
    if (!round || !config) return;
    const entry = config.languages.find((item) => item.id === language);
    setSelectedLanguage(language);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    localStorage.setItem(LEGACY_LANGUAGE_STORAGE_KEY, language);
    if (!entry?.available) {
      setMessage(`“${language}” is in the requested menu, but Quran Foundation does not currently expose a matching translation resource.`);
      return;
    }
    setTranslationLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/quran/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: round.token, language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not switch translation.");
      setRound((previous) => {
        if (!previous) return previous;
        const completion = previous.completion && Array.isArray(data.completionTranslations)
          ? {
              ...previous.completion,
              prompt: previous.completion.prompt.map((verse, index) => ({
                ...verse,
                translation: data.completionTranslations[index] ?? verse.translation,
              })),
            }
          : previous.completion;
        return { ...previous, completion, translation: data.translation, translationMeta: data.translationMeta };
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not switch translation.");
    } finally {
      setTranslationLoading(false);
    }
  };

  if (setupError && !round && !attemptComplete) {
    /*
     * Three kinds, not two. The old catch-all asserted that the Quran
     * Foundation connection was fine and the failure came from a round or audio
     * request — which is wrong for a store failure, and sent at least one
     * person looking at reciters when the real cause was an unreachable Redis.
     * See lib/game/setup-error.ts.
     */
    const kind = classifySetupError(setupError);

    const eyebrow =
      kind === "configuration" ? "SETUP" : kind === "store" ? "STORE ERROR" : "ROUND ERROR";

    const heading =
      kind === "configuration"
        ? "Connect Quran Foundation"
        : kind === "store"
          ? "Could not reach the attempt store"
          : "Could not load this round";

    return (
      <main className="setup-shell">
        <section className="setup-card">
          <div className="setup-brand-lockup"><BrandLockup label="SurahSpot" /></div>
          <p className="eyebrow">SURAHSPOT · {eyebrow}</p>
          <h1>{heading}</h1>
          <p className="setup-copy">{setupError}</p>

          {kind === "configuration" ? (
            <div className="setup-steps">
              <div><b>1</b><span>Create a Backend/server app in the Quran Foundation Developer Console.</span></div>
              <div><b>2</b><span>Copy <code>.env.example</code> to <code>.env.local</code> and add your client ID and secret.</span></div>
              <div><b>3</b><span>Add a long random <code>ROUND_TOKEN_SECRET</code>, then restart the dev server.</span></div>
            </div>
          ) : kind === "store" ? (
            <div className="setup-steps">
              <div><b>1</b><span>This is the attempt store, not Quran Foundation and not a reciter. Rounds cannot be issued without it, because the answer is sealed against attempt state.</span></div>
              <div><b>2</b><span>Running locally? A managed store URL is usually reachable only from inside your hosting provider&rsquo;s network. Remove <code>ATTEMPT_STORE_URL</code> from <code>.env.local</code> and set <code>ALLOW_SINGLE_INSTANCE_STORE=1</code> instead &mdash; it belongs in your deployment&rsquo;s secrets, not in a local env file.</span></div>
              <div><b>3</b><span>Deployed? Check the host resolves from inside the app, and that the URL carries its password &mdash; <code>redis://PASSWORD@host</code> and <code>redis://default:PASSWORD@host</code> are both valid and parse differently.</span></div>
            </div>
          ) : (
            <div className="setup-steps">
              <div><b>1</b><span>Your Quran Foundation connection is working. This error came from a round/audio resource request.</span></div>
              <div><b>2</b><span>SurahSpot will preserve balanced Surah selection and automatically try another compatible chapter reciter when the preferred reciter lacks that Surah.</span></div>
            </div>
          )}

          <button
            className="primary wide"
            onClick={() => {
              /*
               * A store or credential failure is fixed by changing
               * configuration and restarting, so retrying the round in place
               * would just fail again against the same process. A reload at
               * least picks up a restarted server.
               */
              if (kind === "configuration" || kind === "store") {
                window.location.reload();
              } else {
                setSetupError("");
                void newRound(selectedLanguage, selectedReciterId, usedChapterIds);
              }
            }}
          >
            <Icon name="refresh" />{" "}
            {kind === "configuration"
              ? "Retry connection"
              : kind === "store"
                ? "Reload"
                : "Retry round"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <SiteHeader
        navExtra={
          <ModesMenu
            activeModeId={modeId}
            activeVariantId={variantId}
            disabled={modeSwitching || loading || submitting || hintLoading}
            onSelect={switchGameMode}
          />
        }
        actions={
          <>
            <div className="score-mini"><span>Attempt</span><b>{Math.min(stats.rounds, MAX_ROUNDS)}/{MAX_ROUNDS}</b></div>
            <button
              ref={settingsButtonRef}
              className="icon-button"
              onClick={() => setSettingsOpen((value) => !value)}
              aria-label="Settings"
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
            ><Icon name="settings" /></button>
          </>
        }
      />

      {settingsOpen && config && (
        <aside className="settings-popover" ref={settingsRef} role="dialog" aria-label="Settings">
          <div className="settings-title"><span>Settings</span><button onClick={() => setSettingsOpen(false)} aria-label="Close settings"><Icon name="x" size={18} /></button></div>
          <label>
            <span>Appearance</span>
            <div className="segmented appearance-segmented" role="group" aria-label="Appearance">
              {(["system", "light", "dark"] as ThemeMode[]).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={themeMode === mode ? "selected" : ""}
                  aria-pressed={themeMode === mode}
                  onClick={() => setThemeMode(mode)}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </label>
          <label>
            <span>Reciter <small>applies next round</small></span>
            <select value={selectedReciterId ?? ""} onChange={(event) => setSelectedReciterId(Number(event.target.value))}>
              {config.reciters.map((reciter) => <option key={reciter.id} value={reciter.id}>{reciter.name}{reciter.style ? ` · ${reciter.style}` : ""}</option>)}
            </select>
          </label>
          <label>
            <span>Playback speed</span>
            <div className="segmented">
              {[0.75, 1, 1.25].map((value) => <button type="button" key={value} className={rate === value ? "selected" : ""} onClick={() => setRate(value)}>{value}×</button>)}
            </div>
          </label>
          <div className="settings-note">Arabic and verified translations are marked <code>translate="no"</code> to prevent browser auto-translation.</div>
        </aside>
      )}

      {summaryOpen && (
        <div className="summary-overlay" role="dialog" aria-modal="true" aria-labelledby="attempt-summary-title">
          <section className="summary-card">
            <RubElHizbPattern />
            <button className="summary-close" type="button" onClick={() => setSummaryOpen(false)} aria-label="Close attempt summary"><Icon name="x" size={18} /></button>
            <div className="summary-shell">
              <p className="eyebrow summary-eyebrow">ATTEMPT COMPLETE</p>
              <h2 id="attempt-summary-title">Your attempt!</h2>
              <p className="summary-copy">Seven rounds are complete. Here is a neutral tally of how this attempt went.</p>

              <div className="summary-score">
                <span>Total score</span>
                <b>{stats.total}</b>
                <small>points across {MAX_ROUNDS} rounds</small>
              </div>

              <div className="summary-grid">
                <div><span>Rounds</span><b>{stats.rounds}/{MAX_ROUNDS}</b></div>
                <div><span>Correct</span><b>{stats.correct}</b></div>
                <div><span>Accuracy</span><b>{accuracy}%</b></div>
                <div><span>Best streak</span><b>{stats.bestStreak}</b></div>
                <div><span>Current streak</span><b>{stats.streak}</b></div>
                <div><span>Average score</span><b>{averageScore}</b></div>
              </div>

              <ResultShareActions />

              <div className="summary-actions">
                <button type="button" className="secondary-button" onClick={() => setSummaryOpen(false)}>Review board</button>
                <button type="button" className="primary" onClick={startNewAttempt}><Icon name="refresh" size={18} /> Start new attempt</button>
              </div>

              <div className="summary-footer-note">
                <p>{HADITH_FOOTER}</p>
                <small>Sahih al-Bukhari 5027</small>
              </div>
            </div>
          </section>
        </div>
      )}

      <section className="hero">
        <div className="hero-copy">
          {isAyahCounts ? (
            <>
              <div className="live-label"><span></span> RECALL · ESTIMATE · LEARN</div>
              <h1>How many <em>Ayahs</em><br />are in this Surah?</h1>
              <p>
                {isClosestAyahCounts
                  ? "Make your best estimate, then use higher/lower feedback to close in. Your best guess earns points based on how close you get."
                  : "How well do you remember the count? You have five tries, with the same 100/80/60/40/20 score ladder."}
              </p>
            </>
          ) : isCompletion ? (
            <>
              <div className="live-label"><span></span> READ · CONTINUE · REMEMBER</div>
              <h1>Complete the <em>passage</em><br />in the right order.</h1>
              <p>{isCompletionSequence
                ? "Read and listen to the short passage, then put the next Ayahs in order. Correct positions stay in place as you work through the seven rounds."
                : "Read and listen to the short passage, then choose the Ayah that comes next. The Surahs gradually get more challenging as you move through the rounds."}</p>
            </>
          ) : (
            <>
              <div className="live-label"><span></span> LISTEN · RECOGNIZE · REMEMBER</div>
              <h1>Which <em>Surah</em><br />is this Ayah from?</h1>
              <p>Listen to the full Ayah, follow along as it’s recited, then identify the Surah. Each attempt has seven short rounds, with five tries in each one.</p>
            </>
          )}
        </div>
        <div className="hero-stats">
          <div><span>Accuracy</span><b>{accuracy}%</b></div>
          <div><span>Rounds left</span><b>{roundsRemaining}</b></div>
          <div><span>Best streak</span><b>{stats.bestStreak}</b></div>
        </div>
      </section>

      <section className="game-layout">
        <div className="game-column">
          <div className="round-strip">
            <div className="round-meta"><span className="round-dot"></span><span>Round {displayRoundNumber} of {MAX_ROUNDS}</span></div>
            <div
              className="tries"
              role="img"
              aria-label={`${round?.attemptsRemaining ?? 0} tries remaining`}
            >
              {Array.from({ length: MAX_TRIES_PER_ROUND }, (_, index) => <span key={index} className={index < attemptsUsed ? "used" : ""}></span>)}
            </div>
            <div className="points-chip"><span>POINTS</span><b>{round?.pointsRemaining ?? 100}</b></div>
          </div>

          <article className={`ayah-card ${loading ? "loading" : ""}`}>
            {isAyahCounts && round?.surah ? (
              <AyahCountBoard
                surah={round.surah as AyahSurahDisplay}
                variant={round.variant === "closest" ? "closest" : "exact"}
                loading={loading}
                disabled={submitting || status !== "playing"}
                attemptsRemaining={round.attemptsRemaining}
                direction={ayahFeedback.direction}
                lastGuessScore={ayahFeedback.lastGuessScore}
                tryScores={ayahFeedback.tryScores}
                onSubmit={(ayahCount) => submitGuess(undefined, false, ayahCount)}
                onSkipTry={() => submitGuess(undefined, true)}
                onSkipRound={skipCurrentRound}
              />
            ) : isCompletion && round?.surah && round.completion ? (
              <CompletionBoard
                variant={round.variant === "sequence" ? "sequence" : "fill-in"}
                surah={round.surah as CompletionSurahDisplay}
                completion={round.completion}
                karaoke={karaoke}
                translationLanguageRtl={RTL_LANGUAGES.has(selectedLanguage)}
                translationName={surahRound?.translationMeta.name}
                translationLoading={translationLoading}
                disabled={submitting || status !== "playing" || loading}
                feedback={completionFeedback}
                onSubmit={(answer) => submitCompletion(answer)}
                languageSelect={config ? (
                  <select className="language-select completion-language-select" value={selectedLanguage} onChange={(event) => changeLanguage(event.target.value)} aria-label="Translation language">
                    {config.languages.map((language) => (
                      <option key={language.id} value={language.id}>{language.label}{language.available ? "" : " · unavailable"}</option>
                    ))}
                  </select>
                ) : null}
              />
            ) : loading || !round ? (
              <div className="skeleton-wrap">
                <div className="skeleton arabic"></div><div className="skeleton line"></div><div className="skeleton line short"></div>
              </div>
            ) : (
              <>
                <div className="content-label"><span>AYAH</span><span className="hidden-ref">Reference hidden until reveal</span></div>
                <div className={`arabic-text ${arabicDensity}`} dir="rtl" lang="ar" translate="no">
                  {surahRound && surahRound.words.length ? surahRound.words.map((word: { index: number; position: number; arabic: string }, index: number) => {
                    const active = word.position === karaoke.activePosition;
                    const passed = !active && word.position <= karaoke.completedPosition;
                    const style = active
                      ? ({ "--word-progress": `${Math.max(3, karaoke.wordProgress * 100)}%` } as CSSProperties)
                      : undefined;
                    return <span key={`${word.position}-${index}`} style={style} className={`quran-word ${passed ? "passed" : ""} ${active ? "active" : ""}`}>{word.arabic}</span>;
                  }) : <span>{round.arabic}</span>}
                </div>
                <div className="transliteration" translate="no">{surahRound?.transliteration || "Transliteration unavailable for this ayah."}</div>
                <div className="translation-divider"></div>
                <div className="translation-head">
                  <div>
                    <span className="translation-label">Translation</span>
                    <small>{surahRound?.translationMeta.name}</small>
                  </div>
                  {config && (
                    <select className="language-select" value={selectedLanguage} onChange={(event) => changeLanguage(event.target.value)} aria-label="Translation language">
                      {config.languages.map((language) => (
                        <option key={language.id} value={language.id}>{language.label}{language.available ? "" : " · unavailable"}</option>
                      ))}
                    </select>
                  )}
                </div>
                <p className={`translation-text ${translationLoading ? "muted" : ""}`} dir={RTL_LANGUAGES.has(selectedLanguage) ? "rtl" : "ltr"} translate="no">
                  {translationLoading ? "Loading translation…" : round.translation || "No translation was returned for this resource."}
                </p>
              </>
            )}
          </article>

          {!isAyahCounts && <article className="player-card">
            {surahRound && <audio
              ref={audioRef}
              src={surahRound.audio.url}
              preload="metadata"
              // iOS refuses to play inline without this and will try to take
              // over the screen with the native fullscreen player instead.
              playsInline
              onLoadedMetadata={(event) => {
                const audio = event.currentTarget;
                // Seeking before metadata exists is a no-op on iOS, so the
                // start position is applied here rather than on mount.
                seekToAyahStart(audio);
                audio.volume = volume;
                audio.playbackRate = rate;
                setCurrentTime(audio.currentTime);
                setKaraoke(resolveKaraokeState(surahRound.audio.segments, audio.currentTime * 1000));

                /*
                 * Start pulling the Ayah now, rather than on the tap.
                 *
                 * `preload="metadata"` fetches the file header and stops, so
                 * pressing play means waiting for a fresh range request at
                 * the Ayah's offset — through this app's proxy, to the
                 * upstream CDN — before any sound. Promoting here, once the
                 * seek has moved the element to the Ayah, means the fetch
                 * happens while the player is still reading the round.
                 *
                 * Promoted only after the seek: doing it any earlier would
                 * buffer the top of the chapter file, which is never what
                 * gets played.
                 */
                audio.preload = "auto";
              }}
              /*
               * Buffering is reported, not hidden. onWaiting fires when the
               * element runs out of data; onPlaying and onCanPlay clear it.
               */
              onWaiting={() => setBuffering(true)}
              onPlaying={() => setBuffering(false)}
              onCanPlay={(event) => {
                setBuffering(false);
                /*
                 * Enough is buffered. Dropping back to metadata keeps this
                 * from reading further into a chapter file that can run to
                 * two hours — the player only ever hears one Ayah of it, and
                 * mobile data should not pay for the rest.
                 *
                 * Held off while a seek is still in flight: canplay can fire
                 * for the position the element was at before the seek, and
                 * reverting on that would stop the fetch exactly where the
                 * promotion was meant to help.
                 */
                const audio = event.currentTarget;
                if (audio.paused && !audio.seeking) audio.preload = "metadata";
              }}
              onError={() => {
                setIsPlaying(false);
                setBuffering(false);
                setMessage("The recitation could not be loaded. Check your connection and try again.");
              }}
              onStalled={() => setIsPlaying(false)}
              onRateChange={(event) => {
                // Safari silently resets playbackRate on some seeks. Re-assert
                // it so the karaoke timing and the audio stay in agreement.
                const audio = event.currentTarget;
                if (Math.abs(audio.playbackRate - rate) > 0.01) audio.playbackRate = rate;
              }}
              onPlay={() => { setIsPlaying(true); syncPlaybackVisuals(true); }}
              onPause={() => { setIsPlaying(false); setBuffering(false); syncPlaybackVisuals(true); }}
              onTimeUpdate={() => syncPlaybackVisuals(true)}
              onSeeking={() => syncPlaybackVisuals(true)}
              onSeeked={() => syncPlaybackVisuals(true)}
              onEnded={() => { setIsPlaying(false); setBuffering(false); syncPlaybackVisuals(true); }}
            />}
            <div className="player-main">
              <button
                className={`play-button ${buffering ? "is-buffering" : ""}`}
                onClick={togglePlay}
                disabled={!round || loading || status !== "playing"}
                aria-label={isPlaying ? "Pause recitation" : "Play recitation"}
                aria-busy={buffering}
              >
                <Icon name={isPlaying ? "pause" : "play"} size={25} />
                {/* A ring around the control, so the wait reads as loading
                    rather than as a button that did nothing. */}
                {buffering ? <span className="play-button-spinner" aria-hidden="true" /> : null}
              </button>
              <div className="player-track-area">
                <div className="player-title"><span><Icon name="headphones" size={16} /> {surahRound?.audio.reciter ?? "Loading reciter…"}</span><small>{surahRound?.audio.usedFallbackReciter ? `Compatible reciter · ${isCompletion ? "Shown passage" : "Complete Ayah"}` : isCompletion ? "Shown passage" : "Complete Ayah"}</small></div>
                <input className="progress-range" type="range" min="0" max="1000" value={Math.round(progress * 1000)} onChange={(event) => seek(Number(event.target.value) / 1000)} disabled={!round} aria-label="Recitation progress" />
                <div className="time-row"><span>{formatTime(currentRelative)}</span><span>{formatTime(totalDuration)}</span></div>
              </div>
              <div className="volume-control"><Icon name="volume" size={18} /><input type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Volume" /></div>
            </div>
          </article>}

          {!isAyahCounts && !isCompletion && <form className="guess-card" onSubmit={(event) => submitGuess(event)}>
            <div className="guess-label"><span>Your answer</span><small>Search all 114 Surahs</small></div>
            <div className="guess-row">
              <div className="autocomplete" ref={autocompleteRef}>
                <input
                  value={guessText}
                  onChange={(event) => {
                    setGuessText(event.target.value);
                    setSelectedChapter(null);
                    setQfSearchResults(null);
                    setSuggestionsOpen(true);
                  }}
                  onFocus={() => setSuggestionsOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setSuggestionsOpen(false);
                    }
                  }}
                  placeholder="Type a Surah name…"
                  autoComplete="off"
                  /*
                   * aria-expanded and aria-controls are only allowed on a
                   * combobox, so without the role a screen reader is told to
                   * ignore both and the suggestion list becomes invisible to
                   * it. Declaring the role is also simply accurate: this is a
                   * text field that opens a listbox.
                   */
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={suggestionsOpen}
                  aria-controls="surah-search-results"
                  disabled={status !== "playing" || loading}
                />
                {selectedChapter && <span className="selected-check"><Icon name="check" size={16} /></span>}
                {suggestionsOpen && status === "playing" && (
                  <div className="suggestions" id="surah-search-results">
                    {searchLoading && guessText.trim() && <div className="search-status">Searching Quran Foundation…</div>}
                    {!searchLoading && displayedChapters.length === 0 && <div className="search-status">No Surah matches found.</div>}
                    {displayedChapters.map((chapter) => (
                      <button type="button" key={chapter.id} onMouseDown={(event) => event.preventDefault()} onClick={() => {
                        setSelectedChapter(chapter);
                        setGuessText(chapter.nameSimple);
                        setSuggestionsOpen(false);
                      }}>
                        <span className="chapter-num">{String(chapter.id).padStart(3, "0")}</span>
                        <span className="chapter-main"><b>{chapter.nameSimple}</b><small>{chapter.translatedName || `${chapter.versesCount} Ayat`}</small></span>
                        <span className="chapter-arabic" dir="rtl">{chapter.nameArabic}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button className="primary guess-button" disabled={submitting || status !== "playing" || loading}>{submitting ? "Checking…" : "Guess"}<Icon name="chevron" size={18} /></button>
            </div>

            {hintMenuOpen && round && status === "playing" && (
              <div className="hint-picker" role="group" aria-label="Choose a hint">
                <div className="hint-picker-head">
                  <div><span>Choose a hint</span><small>{round?.hints?.hintsRemaining} of {MAX_ATTEMPT_HINTS} left for this attempt</small></div>
                  <b>{round?.hints?.nextHintCost === 0 ? "FREE" : round?.hints?.nextHintCost === SECOND_HINT_COST ? `−${SECOND_HINT_COST} PTS` : "USED"}</b>
                </div>
                <div className="hint-options">
                  {HINT_OPTIONS.map((option) => {
                    const alreadyShown = revealedHints.some((hint) => hint.type === option.type);
                    return (
                      <button
                        type="button"
                        key={option.type}
                        onClick={() => requestHint(option.type)}
                        disabled={hintLoading || alreadyShown || (round?.hints?.hintsRemaining ?? 0) <= 0}
                      >
                        <Icon name="hint" size={17} />
                        <span><b>{option.label}</b><small>{alreadyShown ? "Already revealed this round" : option.detail}</small></span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {revealedHints.length > 0 && (
              <div className="hint-reveals" aria-live="polite">
                {revealedHints.map((hint) => (
                  <div className="hint-reveal" key={hint.type}>
                    <span><Icon name="hint" size={15} /> {hint.label}</span>
                    <b>{hint.value}</b>
                  </div>
                ))}
              </div>
            )}

            <div className="guess-footer">
              <div className="skip-actions">
                <button type="button" className="skip-button" onClick={() => submitGuess(undefined, true)} disabled={submitting || status !== "playing" || loading}><Icon name="skip" size={15} /> Skip this try</button>
                <button type="button" className="skip-button skip-round-button" onClick={skipCurrentRound} disabled={submitting || status !== "playing" || loading} title="End this round now for 0 points"><Icon name="fastForward" size={16} /> Skip round</button>
                <button
                  type="button"
                  className="hint-button"
                  onClick={() => setHintMenuOpen((value) => !value)}
                  disabled={!round || hintLoading || submitting || status !== "playing" || loading || (round?.hints?.hintsRemaining ?? 0) <= 0}
                  aria-expanded={hintMenuOpen}
                >
                  <Icon name="hint" size={16} />
                  Hint
                  <span>{round?.hints?.hintsRemaining ?? 0}/{MAX_ATTEMPT_HINTS}</span>
                  {round?.hints?.nextHintCost === 0 && <small>free</small>}
                  {round?.hints?.nextHintCost === SECOND_HINT_COST && <small>−{SECOND_HINT_COST}</small>}
                </button>
              </div>
              <span className={`feedback ${status}`}>{message}</span>
            </div>
          </form>}

          {isCompletion && round && (
            <div className="guess-card completion-actions-card">
              <div className="guess-footer">
                <div className="skip-actions">
                  <button type="button" className="skip-button" onClick={() => submitCompletion({}, true)} disabled={submitting || status !== "playing" || loading}><Icon name="skip" size={15} /> Skip this try</button>
                  <button type="button" className="skip-button skip-round-button" onClick={skipCurrentRound} disabled={submitting || status !== "playing" || loading} title="End this round now for 0 points"><Icon name="fastForward" size={16} /> Skip round</button>
                </div>
                <span className={`feedback ${status}`}>{message}</span>
              </div>
            </div>
          )}

          {reveal && (
            <div className={`reveal-card ${status}`}>
              <div className="reveal-icon"><Icon name={status === "won" ? "check" : "x"} size={24} /></div>
              <div className="reveal-copy">
                {isAyahCounts && typeof reveal.versesCount === "number" ? (
                  <>
                    <span>{status === "won" ? "Exactly right" : "The exact count was"}</span>
                    <h2>{reveal.versesCount} <i>Ayahs</i></h2>
                    <p>{reveal.nameSimple} · Surah {reveal.chapterId} · {reveal.translatedName}</p>
                  </>
                ) : isCompletion ? (
                  <>
                    <span>{status === "won" ? "Passage completed" : "Correct completion revealed"}</span>
                    <h2>{reveal.nameSimple} <i>{reveal.nameArabic}</i></h2>
                    <p>Surah {reveal.chapterId} · {reveal.translatedName}</p>
                  </>
                ) : (
                  <>
                    <span>{status === "won" ? "You got it" : "The answer was"}</span>
                    <h2>{reveal.nameSimple} <i>{reveal.nameArabic}</i></h2>
                    <p>Surah {reveal.chapterId} · Ayah {reveal.verseKey?.split(":")[1] ?? ""} · {reveal.translatedName}</p>
                  </>
                )}
              </div>
              <div className="reveal-actions">
                {!isAyahCounts && !isCompletion && round?.token && reveal.verseKey && (
                  <VerseShareActions token={round.token} language={selectedLanguage} />
                )}
                {attemptComplete ? (
                  <button className="primary" onClick={() => setSummaryOpen(true)}><Icon name="spark" size={18} /> View attempt</button>
                ) : (
                  <button className="primary" onClick={() => newRound()}><Icon name="refresh" size={18} /> {isAyahCounts ? "Next Surah" : isCompletion ? "Next passage" : "Next Ayah"}</button>
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="side-column">
          <div className="rule-card">
            <p className="eyebrow">HOW IT SCORES</p>
            <h3>Five tries.<br />Seven rounds.</h3>
            {isClosestAyahCounts ? (
              <div className="score-breakdown" aria-label="Score breakdown">
  <div className="score-breakdown-item">
    <div className="score-breakdown-main">
      <span className="score-breakdown-label">Exact guess</span>
      <strong className="score-breakdown-value">100</strong>
    </div>
    <small className="score-breakdown-meta">max points</small>
  </div>

  <div className="score-breakdown-item">
    <div className="score-breakdown-main">
      <span className="score-breakdown-label">Near guess</span>
      <strong className="score-breakdown-value">≈</strong>
    </div>
    <small className="score-breakdown-meta">score based on proximity</small>
  </div>

  <div className="score-breakdown-item">
    <div className="score-breakdown-main">
      <span className="score-breakdown-label">Extra try</span>
      <strong className="score-breakdown-value">−5</strong>
    </div>
    <small className="score-breakdown-meta">points per extra try</small>
  </div>
</div>
            ) : (
              <div className="score-ladder">
                {scoreLadder().map(({ try: tryNumber, points }, index) => (
                  <div key={tryNumber} className={attemptsUsed === index && status === "playing" ? "current" : attemptsUsed > index ? "passed" : ""}>
                    <span>Try {tryNumber}</span><b>{points}</b><small>pts</small>
                  </div>
                ))}
              </div>
            )}
            <p className="rule-note">
              {isAyahCounts
                ? isClosestAyahCounts
                  ? "Each guess earns a proximity score; the best guess carries the round, minus 5 points for every extra try. Higher/lower feedback helps you converge. Skip round ends it for 0 points."
                  : "A wrong count or “Skip this try” spends one try. “Skip round” ends the current Surah immediately for 0 points. Each seven-round attempt uses seven different Surahs."
                : isCompletion
                  ? isCompletionSequence
                    ? "Submit a full sequence. Correct positions lock in place; misplaced Ayahs return to the bank. A wrong submission or skipped try spends one try. No hints are used in Completion."
                    : "Choose one of five Ayahs. A wrong choice or skipped try spends one try. The Surah difficulty rises round by round. No hints are used in Completion."
                  : "A wrong guess or “Skip this try” spends one try. “Skip round” ends the current Ayah immediately for 0 points. Each seven-round attempt uses seven different Surahs."}
            </p>
            {!isAyahCounts && !isCompletion && (
              <p className="rule-note hint-rule-note"><Icon name="hint" size={14} /> {MAX_ATTEMPT_HINTS} hints are available across the entire {MAX_ROUNDS}-round attempt. The first is free; the second reduces that round&rsquo;s score by {SECOND_HINT_COST} points.</p>
            )}
            {reducedCatalog && (
              <p className="rule-note limited-note">
                This Quran Foundation environment serves {config!.playableChapterCount} of 114 Surahs, so rounds are drawn from those and may repeat within an attempt. You can still answer from the full 114.
              </p>
            )}
          </div>

          <div className="tip-card">
            <Icon name="spark" />
            {isAyahCounts ? (
              <div><b>Build count anchors</b><p>Remember a few landmark Surahs by length, then estimate relative to them. In Closest Figure, use each higher/lower clue to narrow the range.</p></div>
            ) : isCompletion ? (
              <div><b>Read the transition</b><p>Use the meaning, cadence, repeated phrasing, and the final idea of the shown block to predict what naturally follows. In Sequence, place your strongest transition first and use locked positions to narrow the rest.</p></div>
            ) : (
              <div><b>Listen for anchors</b><p>Repeated phrases, openings, narrative names, and familiar rhythmic patterns can narrow a Surah faster than individual words.</p></div>
            )}
          </div>

          <div className="session-card">
            <span>ATTEMPT</span>
            <div className="session-total"><b>{stats.total}</b><small>points</small></div>
            <div className="session-grid">
              <div><b>{stats.correct}</b><span>Correct</span></div>
              <div><b>{stats.rounds}/{MAX_ROUNDS}</b><span>Rounds</span></div>
              <div><b>{accuracy}%</b><span>Accuracy</span></div>
              <div><b>{stats.bestStreak}</b><span>Best streak</span></div>
            </div>
          </div>
        </aside>
      </section>

      <SiteFooter />
    </div>
  );
}
