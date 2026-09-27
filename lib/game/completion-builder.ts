import { randomBytes, randomInt } from "node:crypto";
import { qfFetch, isRecoverableUpstream } from "@/lib/quran/client";
import {
  chooseReciter,
  chooseTranslation,
  type Catalog,
  type Chapter,
} from "@/lib/quran/catalog";
import { normalizeSegments, type Segment } from "@/lib/quran/karaoke";
import {
  buildQuranDisplayVerseText,
  buildQuranDisplayWords,
  cleanTranslationHtml,
} from "@/lib/quran/text";
import { unavailable } from "@/lib/http/api-error";
import { resolveTimedChapter, type TimedChapter } from "./round-builder";

const TRANSLITERATION_RESOURCE_ID = 57;
const MAX_CHAPTER_ATTEMPTS = 8;

export type CompletionVariant = "fill-in" | "sequence";

type ApiWord = {
  position: number;
  text_uthmani?: string;
  char_type_name?: string;
};

type ApiVerse = {
  chapter_id: number;
  verse_number: number;
  verse_key: string;
  text_uthmani?: string;
  words?: ApiWord[];
  translations?: Array<{ resource_id: number; text: string }>;
};

export type CompletionVerse = {
  id?: string;
  verseNumber?: number;
  arabic: string;
  transliteration: string;
  translation: string;
  words?: Array<{ index: number; position: number; arabic: string }>;
};

export type BuiltCompletionRound = {
  chapterId: number;
  surah: {
    id: number;
    nameSimple: string;
    nameArabic: string;
    translatedName: string;
    versesCount: number;
  };
  variant: CompletionVariant;
  difficultyLevel: number;
  blankCount: number;
  prompt: CompletionVerse[];
  choices: Array<Required<Pick<CompletionVerse, "id" | "arabic" | "transliteration" | "translation">>>;
  correctChoiceIds: string[];
  promptVerseKeys: string[];
  targetVerseKeys: string[];
  words: Array<{ index: number; position: number; arabic: string }>;
  arabic: string;
  transliteration: string;
  translation: string;
  translationMeta: { language: string; resourceId: number; name: string; author: string };
  audio: {
    fromMs: number;
    toMs: number;
    segments: Segment[];
    reciter: string;
    reciterId: number;
    requestedReciterId: number;
    usedFallbackReciter: boolean;
    url: string;
  };
};

export type BuildCompletionRoundOptions = {
  catalog: Catalog;
  language: string;
  preferredReciterId?: number;
  excludedChapterIds: Set<number>;
  variant: CompletionVariant;
  /** 0-based completed-round count; clamped to the seven-round attempt. */
  difficultyLevel: number;
};

function versePath(chapterId: number, verseNumber: number, translationIds: string) {
  const params = new URLSearchParams({
    page: String(verseNumber),
    per_page: "1",
    words: "true",
    fields: "chapter_id,text_uthmani",
    word_fields: "text_uthmani,location",
    translations: translationIds,
    translation_fields: "resource_name,language_name",
  });
  return `/verses/by_chapter/${chapterId}?${params.toString()}`;
}

async function fetchVerse(chapterId: number, verseNumber: number, translationIds: string) {
  const data = await qfFetch<{ verses: ApiVerse[] }>(versePath(chapterId, verseNumber, translationIds));
  const verse = data.verses?.[0];
  if (!verse || verse.chapter_id !== chapterId || verse.verse_number !== verseNumber) {
    throw unavailable("Quran Foundation returned an unexpected Ayah while building Completion mode.");
  }
  return verse;
}

function cleanVerse(
  verse: ApiVerse,
  translationId: number,
): CompletionVerse {
  const words = buildQuranDisplayWords(verse.words);

  const transliteration =
    verse.translations?.find(
      (item) =>
        item.resource_id === TRANSLITERATION_RESOURCE_ID,
    )?.text ?? "";

  const translated =
    verse.translations?.find(
      (item) =>
        item.resource_id === translationId,
    )?.text ?? "";

  return {
    verseNumber: verse.verse_number,

    arabic: buildQuranDisplayVerseText(
      verse.text_uthmani,
      words,
    ),

    transliteration: cleanTranslationHtml(transliteration),
    translation: cleanTranslationHtml(translated),

    words,
  };
}

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
}

function randomId() {
  return randomBytes(9).toString("base64url");
}

function servedChapters(catalog: Catalog) {
  const served = catalog.upstreamChapterIds.size
    ? catalog.chapters.filter((chapter) => catalog.upstreamChapterIds.has(chapter.id))
    : catalog.chapters;
  return served.length ? served : catalog.chapters;
}

/**
 * Completion difficulty deliberately uses a transparent metric: Surah length.
 * The selectable Surahs are ordered from shorter to longer, divided into seven
 * non-overlapping bands, and round N draws from band N. It is deterministic,
 * easy to test, and avoids pretending that spiritual/familiarity difficulty is
 * objectively measurable.
 */
function difficultyPool(chapters: Chapter[], level: number, minimumVerses: number) {
  const eligible = chapters
    .filter((chapter) => chapter.verses_count >= minimumVerses)
    .sort((a, b) => a.verses_count - b.verses_count || b.id - a.id);
  if (!eligible.length) return [];

  const clamped = Math.max(0, Math.min(6, Math.floor(level)));
  const start = Math.floor((eligible.length * clamped) / 7);
  const end = Math.max(start + 1, Math.floor((eligible.length * (clamped + 1)) / 7));
  return eligible.slice(start, Math.min(eligible.length, end));
}

function feasiblePromptStarts(
  timed: TimedChapter,
  chapter: Chapter,
  promptCount: number,
  blankCount: number,
) {
  const starts: number[] = [];

  /*
   * Example:
   *
   * 10-Ayah Surah
   * prompt = 3
   * hidden sequence = 5
   *
   * We need:
   * [prompt 3] [answer 5]
   *
   * so the final possible starting point must leave room for all 8.
   */
  const lastStart =
    chapter.verses_count -
    promptCount -
    blankCount +
    1;

  for (
    let start = 1;
    start <= lastStart;
    start += 1
  ) {
    let complete = true;

    for (
      let offset = 0;
      offset < promptCount;
      offset += 1
    ) {
      if (!timed.verses.has(start + offset)) {
        complete = false;
        break;
      }
    }

    if (complete) {
      starts.push(start);
    }
  }

  return starts;
}

function pickPromptShape(
  timed: TimedChapter,
  chapter: Chapter,
  blankCount: number,
) {
  /*
   * Completion always shows between 1 and 3 preceding Ayahs.
   *
   * The prompt + hidden continuation must fit entirely inside the Surah,
   * which also guarantees that the displayed block itself can never equal
   * the complete Surah.
   */
  const maxPrompt = Math.min(
    3,
    chapter.verses_count - blankCount,
  );

  if (maxPrompt < 1) {
    return null;
  }

  const counts = shuffled(
    Array.from(
      { length: maxPrompt },
      (_, index) => index + 1,
    ),
  );

  for (const promptCount of counts) {
    const starts = feasiblePromptStarts(
      timed,
      chapter,
      promptCount,
      blankCount,
    );

    if (starts.length) {
      return {
        promptCount,
        startVerse:
          starts[randomInt(starts.length)],
      };
    }
  }

  return null;
}

async function buildFillChoices({
  correct,
  promptNumbers,
  chapter,
  catalog,
  translationIds,
  translationId,
}: {
  correct: ApiVerse;
  promptNumbers: Set<number>;
  chapter: Chapter;
  catalog: Catalog;
  translationIds: string;
  translationId: number;
}) {
  const refs: Array<{
    chapterId: number;
    verseNumber: number;
  }> = [];

  const seen = new Set<string>([
    `${chapter.id}:${correct.verse_number}`,
  ]);

  /*
   * Five total choices:
   *
   *   1 correct
   * + 4 distractors
   */
  const local = shuffled(
    Array.from(
      { length: chapter.verses_count },
      (_, index) => index + 1,
    ).filter(
      (number) =>
        number !== correct.verse_number &&
        !promptNumbers.has(number),
    ),
  );

  /*
   * Prefer other Ayahs from the same Surah first.
   */
  for (const verseNumber of local) {
    if (refs.length >= 4) {
      break;
    }

    refs.push({
      chapterId: chapter.id,
      verseNumber,
    });

    seen.add(
      `${chapter.id}:${verseNumber}`,
    );
  }

  /*
   * Small Surahs may not contain enough local distractors,
   * so supplement them from other served Surahs.
   */
  const others = shuffled(
    servedChapters(catalog),
  );

  let guard = 0;

  while (
    refs.length < 4 &&
    guard < 80
  ) {
    guard += 1;

    const candidateChapter =
      others[randomInt(others.length)];

    const verseNumber = randomInt(
      1,
      candidateChapter.verses_count + 1,
    );

    const key =
      `${candidateChapter.id}:${verseNumber}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    refs.push({
      chapterId: candidateChapter.id,
      verseNumber,
    });
  }

  if (refs.length < 4) {
    throw unavailable(
      "Could not assemble five unique Ayah choices for this Completion round.",
    );
  }

  const distractors = await Promise.all(
    refs.map(
      ({ chapterId, verseNumber }) =>
        fetchVerse(
          chapterId,
          verseNumber,
          translationIds,
        ),
    ),
  );

  const all = [
    correct,
    ...distractors,
  ].map((verse) => {
    const cleaned = cleanVerse(
      verse,
      translationId,
    );

    return {
      id: randomId(),

      arabic:
        cleaned.arabic,

      transliteration:
        cleaned.transliteration,

      translation:
        cleaned.translation,

      verseKey:
        verse.verse_key,
    };
  });

  const correctEntry = all[0];

  return {
    choices: shuffled(
      all.map(
        ({
          verseKey: _verseKey,
          ...choice
        }) => choice,
      ),
    ),

    correctChoiceIds: [
      correctEntry.id,
    ],
  };
}

export async function buildCompletionRound({
  catalog,
  language,
  preferredReciterId,
  excludedChapterIds,
  variant,
  difficultyLevel,
}: BuildCompletionRoundOptions): Promise<BuiltCompletionRound> {
  const translation = chooseTranslation(catalog.translations, language) ?? chooseTranslation(catalog.translations, "english");
  const preferredReciter = chooseReciter(catalog.reciters, preferredReciterId);
  if (!translation) throw unavailable("No translation resource is available right now.");
  if (!preferredReciter) throw unavailable("No chapter reciter is available right now.");

  const blankCount =
  variant === "sequence"
    ? Math.min(
        5,
        Math.max(
          2,
          Math.floor(difficultyLevel) + 2,
        ),
      )
    : 1;

/*
 * At minimum, every Completion round requires:
 *
 *   1 displayed Ayah
 * + N hidden continuation Ayahs
 *
 * Fill-in:
 *   1 + 1
 *
 * Sequence:
 *   1 + 2..5
 */
const minimumVerses = blankCount + 1;

const served = servedChapters(catalog);

/*
 * Fill-in increases difficulty through the existing Surah
 * difficulty bands.
 *
 * Sequence's primary difficulty axis is the number of following
 * Ayahs that must be ordered: 2 → 5.
 */
const eligible =
  variant === "fill-in"
    ? difficultyPool(
        served,
        difficultyLevel,
        minimumVerses,
      )
    : served.filter(
        (chapter) =>
          chapter.verses_count >= minimumVerses,
      );

const fresh = eligible.filter(
  (chapter) =>
    !excludedChapterIds.has(chapter.id),
);

const chapterPool = shuffled(
  fresh.length ? fresh : eligible,
);

if (!chapterPool.length) {
  throw unavailable(
    "No Surah is large enough for this Completion round.",
  );
}

  const translationIds = Array.from(new Set([TRANSLITERATION_RESOURCE_ID, translation.id])).join(",");
  let chapter: Chapter | null = null;
  let timedChapter: TimedChapter | null = null;
  let promptCount = 0;
  let startVerse = 0;

  for (let attempt = 0; attempt < Math.min(MAX_CHAPTER_ATTEMPTS, chapterPool.length); attempt += 1) {
    const candidate = chapterPool[attempt];
    try {
      const timed = await resolveTimedChapter(catalog.reciters, preferredReciter.id, candidate.id);
      if (!timed) continue;
      const shape = pickPromptShape(timed, candidate, blankCount);
      if (!shape) continue;
      chapter = candidate;
      timedChapter = timed;
      promptCount = shape.promptCount;
      startVerse = shape.startVerse;
      break;
    } catch (error) {
      if (isRecoverableUpstream(error)) continue;
      throw error;
    }
  }

  if (!chapter || !timedChapter || !promptCount || !startVerse) {
    throw unavailable("No timed Surah passage was available for this Completion round. Please retry.");
  }

  const promptNumbers = Array.from(
  { length: promptCount },
  (_, index) =>
    startVerse + index,
);

const targetNumbers = Array.from(
  { length: blankCount },
  (_, index) =>
    startVerse +
    promptCount +
    index,
);

const allNumbers = [
  ...promptNumbers,
  ...targetNumbers,
];
  const verses = await Promise.all(allNumbers.map((number) => fetchVerse(chapter!.id, number, translationIds)));
  const promptApi = verses.slice(0, promptCount);
  const targetsApi = verses.slice(promptCount);
  const prompt = promptApi.map((verse) => cleanVerse(verse, translation.id));
  const targetClean = targetsApi.map((verse) => cleanVerse(verse, translation.id));

  // Flatten prompt word positions into one unique position space. QF positions
  // reset to 1 for every Ayah, while the existing karaoke renderer expects one
  // monotonically increasing position sequence.
  let wordOffset = 0;
  const words: BuiltCompletionRound["words"] = [];
  const segments: Segment[] = [];
  for (let index = 0; index < promptApi.length; index += 1) {
    const apiVerse = promptApi[index];
    const cleaned = prompt[index];
    const timing = timedChapter.verses.get(apiVerse.verse_number)!;
    const localWords = cleaned.words ?? [];
    const globalWords = localWords.map((word) => ({
      index: words.length + word.index,
      position: wordOffset + word.position,
      arabic: word.arabic,
    }));
    prompt[index].words = globalWords;
    words.push(...globalWords);
    for (const [position, startMs, endMs] of normalizeSegments(timing.segments)) {
      segments.push([wordOffset + position, startMs, endMs]);
    }
    const localMax = Math.max(0, ...localWords.map((word) => word.position));
    wordOffset += localMax;
  }

  let choices: BuiltCompletionRound["choices"];
  let correctChoiceIds: string[];
  if (variant === "fill-in") {
    const fill = await buildFillChoices({
      correct: targetsApi[0],
      promptNumbers: new Set(promptNumbers),
      chapter,
      catalog,
      translationIds,
      translationId: translation.id,
    });
    choices = fill.choices;
    correctChoiceIds = fill.correctChoiceIds;
  } else {
    const ordered = targetClean.map((verse) => ({
      id: randomId(),
      arabic: verse.arabic,
      transliteration: verse.transliteration,
      translation: verse.translation,
    }));
    correctChoiceIds = ordered.map((choice) => choice.id);
    choices = shuffled(ordered);
  }

  const firstTiming = timedChapter.verses.get(promptNumbers[0])!;
  const lastTiming = timedChapter.verses.get(promptNumbers[promptNumbers.length - 1])!;

  return {
    chapterId: chapter.id,
    surah: {
      id: chapter.id,
      nameSimple: chapter.name_simple,
      nameArabic: chapter.name_arabic,
      translatedName: chapter.translated_name?.name ?? "",
      versesCount: chapter.verses_count,
    },
    variant,
    difficultyLevel: Math.max(0, Math.min(6, Math.floor(difficultyLevel))),
    blankCount,
    prompt,
    choices,
    correctChoiceIds,
    promptVerseKeys: promptApi.map((verse) => verse.verse_key),
    targetVerseKeys: targetsApi.map((verse) => verse.verse_key),
    words,
    arabic: prompt.map((verse) => verse.arabic).join(" "),
    transliteration: prompt.map((verse) => verse.transliteration).join(" · "),
    translation: prompt.map((verse) => verse.translation).join(" "),
    translationMeta: {
      language,
      resourceId: translation.id,
      name: translation.name,
      author: translation.author_name,
    },
    audio: {
      fromMs: firstTiming.timestampFrom,
      toMs: lastTiming.timestampTo,
      segments: segments.sort((a, b) => a[1] - b[1] || a[0] - b[0]),
      reciter: timedChapter.reciter.name,
      reciterId: timedChapter.reciter.id,
      requestedReciterId: preferredReciter.id,
      usedFallbackReciter: timedChapter.reciter.id !== preferredReciter.id,
      url: timedChapter.audioUrl,
    },
  };
}
