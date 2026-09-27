import { randomInt } from "node:crypto";
import { type Catalog } from "@/lib/quran/catalog";
import { unavailable } from "@/lib/http/api-error";

/**
 * Builds a round for the Ayah Counts mode.
 *
 * Far simpler than the Identify-the-Surah builder, and deliberately so: the
 * Surah is shown rather than hidden, so there is no recitation to fetch, no
 * reciter coverage to resolve, and no word timing to normalize. Everything
 * needed is already in the cached catalog, which means a round costs zero
 * upstream calls and the mode stays playable even while Quran Foundation is
 * degraded.
 *
 * Kept in its own module rather than branching inside round-builder.ts. The two
 * modes share almost no logic, and folding them together would mean every
 * future change to the audio path risked breaking a mode that has no audio.
 */

export type AyahCountRound = {
  chapterId: number;
  /** The answer. Sealed into the round token, never sent to the browser. */
  versesCount: number;
  display: {
    nameArabic: string;
    nameSimple: string;
    nameComplex: string;
    translatedName: string;
    /** Revelation place is shown as context, not as a hint to be purchased. */
    revelationPlace: string;
  };
};

export type BuildAyahCountRoundOptions = {
  catalog: Catalog;
  excludedChapterIds: Set<number>;
};

export function buildAyahCountRound({
  catalog,
  excludedChapterIds,
}: BuildAyahCountRoundOptions): AyahCountRound {
  // Only Surahs the environment actually serves, and only those with a usable
  // verse count — a missing count would make the round unanswerable.
  const selectable = catalog.chapters.filter((chapter) => {
    if (catalog.upstreamChapterIds.size && !catalog.upstreamChapterIds.has(chapter.id)) return false;
    return Number.isInteger(chapter.verses_count) && chapter.verses_count > 0;
  });

  if (!selectable.length) {
    throw unavailable("No Surahs are available for this round.");
  }

  // Surahs already used in this attempt stay excluded, but if the environment
  // serves fewer than an attempt needs, repeat rather than fail.
  const available = selectable.filter((chapter) => !excludedChapterIds.has(chapter.id));
  const pool = available.length ? available : selectable;

  // Uniform across Surahs. Weighting by length would make the mode a game of
  // "guess whether this is a long one", which is a worse game.
  const chapter = pool[randomInt(pool.length)];

  return {
    chapterId: chapter.id,
    versesCount: chapter.verses_count,
    display: {
      nameArabic: chapter.name_arabic ?? "",
      nameSimple: chapter.name_simple ?? "",
      nameComplex: chapter.name_complex ?? chapter.name_simple ?? "",
      translatedName: chapter.translated_name?.name ?? "",
      revelationPlace: chapter.revelation_place ?? "",
    },
  };
}
