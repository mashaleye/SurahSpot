"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import type { KaraokeState } from "@/lib/quran/karaoke";

export type CompletionChoice = {
  id: string;
  arabic: string;
  transliteration: string;
  translation: string;
};

export type CompletionPromptVerse = {
  verseNumber?: number;
  arabic: string;
  transliteration: string;
  translation: string;
  words?: Array<{ index: number; position: number; arabic: string }>;
};

export type CompletionRoundData = {
  difficultyLevel: number;
  blankCount: number;
  prompt: CompletionPromptVerse[];
  choices: CompletionChoice[];
};

export type CompletionFeedback = {
  correctPositions?: boolean[];
  correctChoiceIds?: string[];
  nonce: number;
} | null;


function toArabicIndicDigits(value: number) {
  return String(value).replace(/\d/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)] ?? digit);
}

function AyahMarker({ verseNumber }: { verseNumber?: number }) {
  if (!verseNumber) return null;

  return (
    <span
      className="completion-ayah-marker"
      aria-label={`Ayah ${verseNumber}`}
    >
      {toArabicIndicDigits(verseNumber)}
    </span>
  );
}

type Props = {
  variant: "fill-in" | "sequence";
  surah: {
    id: number;
    nameSimple: string;
    nameArabic: string;
    translatedName: string;
    versesCount: number;
  };
  completion: CompletionRoundData;
  karaoke: KaraokeState;
  translationLanguageRtl: boolean;
  translationName?: string;
  languageSelect?: ReactNode;
  translationLoading?: boolean;
  disabled?: boolean;
  feedback: CompletionFeedback;
  onSubmit: (answer: { choiceId?: string; order?: string[] }) => void;
};

function ChoiceContent({ choice, detailed = false }: { choice: CompletionChoice; detailed?: boolean }) {
  return (
    <span className={`completion-choice-content ${detailed ? "is-detailed" : ""}`}>
      <span className="completion-choice-arabic" dir="rtl" lang="ar" translate="no">
        {choice.arabic}
      </span>
      {detailed ? (
        <span className="completion-choice-details">
          <span translate="no">{choice.transliteration}</span>
          <small translate="no">{choice.translation}</small>
        </span>
      ) : null}
    </span>
  );
}

export function CompletionBoard({
  variant,
  surah,
  completion,
  karaoke,
  translationLanguageRtl,
  translationName,
  languageSelect,
  translationLoading = false,
  disabled = false,
  feedback,
  onSubmit,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [slots, setSlots] = useState<Array<string | null>>(() => Array(completion.blankCount).fill(null));
  const [locked, setLocked] = useState<boolean[]>(() => Array(completion.blankCount).fill(false));
  const [misplacedIds, setMisplacedIds] = useState<Set<string>>(() => new Set());

  const choiceById = useMemo(() => new Map(completion.choices.map((choice) => [choice.id, choice])), [completion.choices]);

  // New round. The completion object is preserved while a token rotates, so
  // this does not erase progress after a wrong submission.
  useEffect(() => {
    setSelectedId(null);
    selectedIdRef.current = null;
    setSlots(Array(completion.blankCount).fill(null));
    setLocked(Array(completion.blankCount).fill(false));
    setMisplacedIds(new Set());
  }, [completion]);

  useEffect(() => {
    if (!feedback) return;
    if (feedback.correctChoiceIds?.length) {
      if (variant === "fill-in") {
        const correctId = feedback.correctChoiceIds[0] ?? null;
        selectedIdRef.current = correctId;
        setSelectedId(correctId);
      } else {
        setSlots(feedback.correctChoiceIds.slice(0, completion.blankCount));
        setLocked(Array(completion.blankCount).fill(true));
      }
      return;
    }

    if (variant === "sequence" && feedback.correctPositions?.length) {
      setSlots((previous) => {
        const wrong = previous.filter((id, index): id is string => Boolean(id) && !feedback.correctPositions?.[index]);
        setMisplacedIds(new Set(wrong));
        return previous.map((id, index) => feedback.correctPositions?.[index] ? id : null);
      });
      setLocked((previous) => previous.map((value, index) => value || Boolean(feedback.correctPositions?.[index])));
    } else if (variant === "fill-in" && feedback.correctPositions?.[0] === false && selectedIdRef.current) {
      setMisplacedIds(new Set([selectedIdRef.current]));
    }
  }, [feedback, variant, completion.blankCount]);

  const usedIds = new Set(slots.filter((id): id is string => Boolean(id)));
  const availableChoices = variant === "sequence"
    ? completion.choices.filter((choice) => !usedIds.has(choice.id))
    : completion.choices;

  const placeChoice = (choiceId: string, slotIndex?: number) => {
    if (disabled || variant !== "sequence") return;
    setMisplacedIds((previous) => {
      if (!previous.has(choiceId)) return previous;
      const next = new Set(previous);
      next.delete(choiceId);
      return next;
    });
    setSlots((previous) => {
      const next = [...previous];
      const existingIndex = next.findIndex((id) => id === choiceId);
      let target = slotIndex;
      if (target === undefined) target = next.findIndex((id, index) => id === null && !locked[index]);
      if (target < 0 || target >= next.length || locked[target]) return previous;
      if (existingIndex === target) return previous;
      if (existingIndex >= 0 && !locked[existingIndex]) {
        const displaced = next[target];
        next[target] = choiceId;
        next[existingIndex] = displaced ?? null;
      } else {
        next[target] = choiceId;
      }
      return next;
    });
  };

  const removeFromSlot = (index: number) => {
    if (disabled || locked[index]) return;
    setSlots((previous) => previous.map((id, slot) => slot === index ? null : id));
  };

  const onDragStart = (event: DragEvent, id: string) => {
    event.dataTransfer.setData("text/plain", id);
    event.dataTransfer.effectAllowed = "move";
  };

  const onDrop = (event: DragEvent, index: number) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain");
    if (id) placeChoice(id, index);
  };

  const canSubmit = variant === "fill-in" ? Boolean(selectedId) : slots.every(Boolean);
  const revealedFill = variant === "fill-in" && feedback?.correctChoiceIds?.[0]
    ? choiceById.get(feedback.correctChoiceIds[0])
    : null;
  const promptTransliteration = completion.prompt
    .map((verse) => verse.transliteration.trim())
    .filter(Boolean)
    .join(" ");
  const promptTranslation = completion.prompt
    .map((verse) => verse.translation.trim())
    .filter(Boolean)
    .join(" ");

  return (
    <div className="completion-board">
      <header className="completion-surah-head">
        <div>
          <span className="content-label completion-label">SURAH SHOWN</span>
          <h2>{surah.nameSimple} <i dir="rtl" lang="ar">{surah.nameArabic}</i></h2>
          <p>{surah.translatedName} · {surah.versesCount} Ayahs</p>
        </div>
        <span className="completion-difficulty">Level {completion.difficultyLevel + 1}/7</span>
      </header>

      <div className="completion-passage" aria-label="Ayah passage to continue">
        <div className="completion-mushaf-shell">
          <div className="completion-mushaf-arabic" dir="rtl" lang="ar" translate="no">
            {completion.prompt.map((verse, verseIndex) => (
              <Fragment key={`${verse.verseNumber ?? verseIndex}-${verseIndex}`}>
                <span className="completion-mushaf-verse">
                  {verse.words?.length ? verse.words.map((word, index) => {
                    const active = word.position === karaoke.activePosition;
                    const passed = !active && word.position <= karaoke.completedPosition;
                    const style = active
                      ? ({ "--word-progress": `${Math.max(3, karaoke.wordProgress * 100)}%` } as CSSProperties)
                      : undefined;
                    return (
                      <Fragment key={`${word.position}-${index}`}>
                        <span
                          style={style}
                          className={`quran-word ${passed ? "passed" : ""} ${active ? "active" : ""}`}
                        >{word.arabic}</span>{" "}
                      </Fragment>
                    );
                  }) : verse.arabic}
                  <AyahMarker verseNumber={verse.verseNumber ?? verseIndex + 1} />{" "}
                </span>
              </Fragment>
            ))}
          </div>

          <div className="completion-reading-copy">
            <div className="transliteration completion-default-transliteration" translate="no">
              {promptTransliteration || "Transliteration unavailable for this passage."}
            </div>

            <div className="translation-divider completion-translation-divider" />

            <div className="translation-head completion-translation-head">
              <div>
                <span className="translation-label">Translation</span>
                <small>{translationName || "Translation"}</small>
              </div>
              {languageSelect}
            </div>

            <p
              className={`translation-text completion-default-translation ${translationLoading ? "muted" : ""}`}
              dir={translationLanguageRtl ? "rtl" : "ltr"}
              translate="no"
            >
              {translationLoading ? "Loading translation…" : promptTranslation || "No translation was returned for this resource."}
            </p>
          </div>
        </div>

        <div className={`completion-blanks ${variant}`}>
          {variant === "fill-in" ? (
            <div className={`completion-blank-slot ${revealedFill ? "is-correct is-filled" : ""}`}>
              {revealedFill ? <ChoiceContent choice={revealedFill} detailed /> : <span>Choose the Ayah that proceeds this block</span>}
            </div>
          ) : slots.map((id, index) => {
            const choice = id ? choiceById.get(id) : null;
            return (
              <button
                type="button"
                key={index}
                className={`completion-sequence-slot ${locked[index] ? "is-correct is-locked" : choice ? "is-filled" : ""}`}
                onClick={() => removeFromSlot(index)}
                onDragOver={(event) => { if (!locked[index]) event.preventDefault(); }}
                onDrop={(event) => onDrop(event, index)}
                disabled={disabled || locked[index]}
                aria-label={`Sequence position ${index + 1}${choice ? ": filled" : ": empty"}`}
              >
                <span className="completion-slot-number">{index + 1}</span>
                {choice ? <ChoiceContent choice={choice} detailed={locked[index]} /> : <span className="completion-slot-placeholder">Place Ayah {index + 1}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <section className="completion-bank-wrap">
        <div className="completion-bank-head">
          <div><span>{variant === "fill-in" ? "AYAH CHOICES" : "AYAH BANK"}</span><small>{variant === "fill-in" ? "1 of 5 continues the passage" : "Tap, click, or drag Ayahs into the sequence"}</small></div>
        </div>
        <div className={`completion-bank ${variant}`} role={variant === "fill-in" ? "radiogroup" : "list"}>
          {availableChoices.map((choice) => {
            const selected = variant === "fill-in" && selectedId === choice.id;
            return (
              <button
                type="button"
                key={choice.id}
                className={`completion-choice ${selected ? "is-selected" : ""} ${misplacedIds.has(choice.id) ? "is-misplaced" : ""}`}
                onClick={() => {
                  if (variant === "fill-in") {
                    setMisplacedIds(new Set());
                    selectedIdRef.current = choice.id;
                    setSelectedId(choice.id);
                  } else placeChoice(choice.id);
                }}
                disabled={disabled || Boolean(feedback?.correctChoiceIds?.length)}
                role={variant === "fill-in" ? "radio" : undefined}
                aria-checked={variant === "fill-in" ? selected : undefined}
                draggable={variant === "sequence" && !disabled}
                onDragStart={(event) => onDragStart(event, choice.id)}
              >
                <ChoiceContent choice={choice} />
              </button>
            );
          })}
        </div>
      </section>

      <div className="completion-submit-row">
  <p>
    {variant === "fill-in"
      ? "Select one Ayah, then submit."
      : `${completion.blankCount} Ayahs to order · correct positions lock after each submit.`}
  </p>

  <button
    type="button"
    className="primary completion-submit"
    disabled={
      disabled ||
      !canSubmit ||
      Boolean(feedback?.correctChoiceIds?.length)
    }
    onClick={() =>
      onSubmit(
        variant === "fill-in"
          ? {
              choiceId: selectedId ?? undefined,
            }
          : {
              order: slots.filter(
                (id): id is string => Boolean(id),
              ),
            },
      )
    }
  >
    Submit
  </button>
</div>
    </div>
  );
}
