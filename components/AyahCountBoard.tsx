"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { MAX_AYAH_GUESS, closestFigureScore } from "@/lib/game/scoring-ayah-count";

/**
 * Board for the Ayah Counts mode.
 *
 * Reuses the shell the base game already establishes — the same round strip,
 * card and footer sit around it in the parent — and replaces only the middle:
 * the Surah is displayed large and centred (Arabic, then transliteration, then
 * meaning) and the answer is a number rather than a Surah search.
 *
 * Presentational by design. It owns the input field and nothing else; scoring,
 * tries and round transitions stay with the parent so both modes share one
 * attempt lifecycle.
 */

export type AyahSurahDisplay = {
  nameArabic: string;
  nameSimple: string;
  nameComplex: string;
  translatedName: string;
  revelationPlace: string;
};

export type AyahCountBoardProps = {
  surah: AyahSurahDisplay;
  variant: "exact" | "closest";
  loading: boolean;
  disabled: boolean;
  attemptsRemaining: number;
  /** Last guess feedback, cleared by the parent when a new round starts. */
  direction?: "higher" | "lower" | "exact";
  lastGuessScore?: number;
  tryScores?: number[];
  onSubmit: (ayahCount: number) => void;
  onSkipTry: () => void;
  onSkipRound: () => void;
};

export function AyahCountBoard({
  surah,
  variant,
  loading,
  disabled,
  attemptsRemaining,
  direction,
  lastGuessScore,
  tryScores,
  onSubmit,
  onSkipTry,
  onSkipRound,
}: AyahCountBoardProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Clearing on a new Surah stops the previous answer sitting in the field,
  // where a fast player would submit it by reflex.
  useEffect(() => {
    setValue("");
    if (!loading && !disabled) inputRef.current?.focus();
  }, [surah.nameSimple, loading, disabled]);

  const parsed = Number(value);
  const isSubmittable =
    Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_AYAH_GUESS && !disabled && !loading;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isSubmittable) return;
    onSubmit(parsed);
    setValue("");
  };

  if (loading) {
    return (
      <div className="skeleton-wrap">
        <div className="skeleton arabic"></div>
        <div className="skeleton line"></div>
        <div className="skeleton line short"></div>
      </div>
    );
  }

  return (
    <>
      <div className="content-label">
        <span>NAME THE AYAH COUNT</span>
        <span className="hidden-ref">
          {variant === "closest" ? "Closest figure scores" : "Exact figure only"}
        </span>
      </div>

      {/* translate="no" for the same reason as the Ayah text: a browser
          translation extension rewriting the Surah name would corrupt the
          prompt the whole round rests on. */}
      <div className="ayah-count-surah" translate="no">
        <p className="ayah-count-arabic" lang="ar" dir="rtl">
          {surah.nameArabic}
        </p>
        <p className="ayah-count-translit">{surah.nameComplex || surah.nameSimple}</p>
        <p className="ayah-count-meaning">{surah.translatedName}</p>
        {surah.revelationPlace ? (
          <span className="ayah-count-place">
            {/^(makkah|mecca)$/i.test(surah.revelationPlace) ? "Makki" : "Madani"}
          </span>
        ) : null}
      </div>

      <form className="ayah-count-answer" onSubmit={submit}>
        <label className="ayah-count-label" htmlFor="ayah-count-input">
          How many Ayahs?
        </label>
        <div className="ayah-count-row">
          <input
            ref={inputRef}
            id="ayah-count-input"
            className="ayah-count-input"
            // type=text with a numeric inputMode: type=number brings spinners
            // and, on iOS, a keypad that still permits "e" and "." — neither of
            // which is a valid Ayah count.
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={3}
            placeholder="0"
            value={value}
            disabled={disabled}
            onChange={(event) => setValue(event.target.value.replace(/[^0-9]/g, ""))}
            aria-describedby="ayah-count-feedback"
          />
          <button type="submit" className="primary ayah-count-submit" disabled={!isSubmittable}>
            Submit
          </button>
        </div>

        {/*
          Live preview of what this guess would be worth, in Closest Figure
          only. It comes from closestFigureScore — the same pure function the
          server scores with — so the number shown can never disagree with the
          number awarded. It is a *preview*, not the answer: it needs the real
          count to compute, which the client does not have, so it only appears
          once a guess has been scored.
        */}
        <p className="ayah-count-feedback" id="ayah-count-feedback" role="status">
          {direction === "higher" && <span className="ayah-hint-up">Higher &#8593;</span>}
          {direction === "lower" && <span className="ayah-hint-down">Lower &#8595;</span>}
          {typeof lastGuessScore === "number" && variant === "closest" && (
            <span className="ayah-last-score">Last guess scored {lastGuessScore}</span>
          )}
          {attemptsRemaining > 0 && (
            <small>
              {attemptsRemaining} {attemptsRemaining === 1 ? "try" : "tries"} left
            </small>
          )}
        </p>

        {/* Per-try history, so a player can see which guess is carrying the
            round under best-of scoring. */}
        {variant === "closest" && tryScores?.length ? (
          <ol className="ayah-try-scores" aria-label="Scores for each try">
            {tryScores.map((score, index) => (
              <li
                key={index}
                className={score === Math.max(...tryScores) ? "is-best" : ""}
                title={score === Math.max(...tryScores) ? "Best guess so far" : undefined}
              >
                <span>{index + 1}</span>
                <b>{score}</b>
              </li>
            ))}
          </ol>
        ) : null}

        <div className="ayah-count-actions">
          <button type="button" className="skip-button" onClick={onSkipTry} disabled={disabled}>
            Skip this try
          </button>
          <button
            type="button"
            className="skip-button skip-round-button"
            onClick={onSkipRound}
            disabled={disabled}
            title="End this round now for 0 points"
          >
            Skip round
          </button>
        </div>
      </form>
    </>
  );
}

/**
 * Preview helper for callers that already know the answer — used by the reveal
 * card to show what a different guess would have been worth.
 */
export function previewScore(guess: number, actual: number) {
  return closestFigureScore(guess, actual);
}
