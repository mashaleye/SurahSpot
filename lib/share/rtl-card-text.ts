/**
 * next/og currently renders Arabic word runs in left-to-right word order even
 * when the glyph shaping inside each word is correct. The browser-rendered
 * share page does not have this problem.
 *
 * For generated ImageResponse cards we therefore wrap the logical Ayah into
 * stable lines ourselves, then reverse ONLY the word sequence inside each
 * line. Satori's existing bidi shaping still handles the Arabic characters in
 * each word, while the visual word order becomes the same RTL order the user
 * sees in the full browser card.
 *
 * Keep this workaround isolated here so it can be removed when the project's
 * next/og version ships native RTL word ordering.
 */

const ARABIC_COMBINING_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu;

function visualUnits(word: string) {
  const withoutMarks = word.replace(ARABIC_COMBINING_MARKS, "");
  return Math.max(1, Array.from(withoutMarks).length);
}

function excerptAtWordBoundary(text: string, maxChars: number) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxChars) {
    return { text: normalized, truncated: false };
  }

  const words = normalized.split(" ");
  const kept: string[] = [];
  let length = 0;

  for (const word of words) {
    const nextLength = length + (kept.length > 0 ? 1 : 0) + word.length;
    if (nextLength > maxChars) break;
    kept.push(word);
    length = nextLength;
  }

  return {
    text: kept.join(" ").trim(),
    truncated: kept.length < words.length,
  };
}

export type ArabicSatoriLineOptions = {
  maxChars?: number;
  maxVisualUnitsPerLine?: number;
  maxLines?: number;
};

/**
 * Returns the strings exactly as they should be passed to legacy Satori.
 * The array itself stays in normal reading order from first line to last line;
 * only the words inside an individual line are reversed for Satori's LTR word
 * positioning bug.
 */
export function buildArabicSatoriLines(
  source: string,
  {
    maxChars = 190,
    maxVisualUnitsPerLine = 42,
    maxLines = 3,
  }: ArabicSatoriLineOptions = {},
) {
  const excerpt = excerptAtWordBoundary(source, maxChars);
  if (!excerpt.text) return [] as string[];

  const words = excerpt.text.split(" ");
  const logicalLines: string[][] = [];
  let current: string[] = [];
  let units = 0;
  let consumedWords = 0;

  for (const word of words) {
    const wordUnits = visualUnits(word);
    const nextUnits = units + (current.length > 0 ? 1 : 0) + wordUnits;

    if (current.length > 0 && nextUnits > maxVisualUnitsPerLine) {
      if (logicalLines.length >= maxLines - 1) break;
      logicalLines.push(current);
      current = [word];
      units = wordUnits;
      consumedWords += 1;
      continue;
    }

    current.push(word);
    units = nextUnits;
    consumedWords += 1;
  }

  if (current.length > 0) logicalLines.push(current);

  const didTruncate = excerpt.truncated || consumedWords < words.length;
  if (didTruncate && logicalLines.length > 0) {
    const lastLine = logicalLines[logicalLines.length - 1];
    const lastIndex = lastLine.length - 1;
    lastLine[lastIndex] = `${lastLine[lastIndex]}…`;
  }

  return logicalLines.map((line) => [...line].reverse().join(" "));
}
