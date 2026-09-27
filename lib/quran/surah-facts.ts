/**
 * Structural facts about each Surah, held locally.
 *
 * Deliberately does not import the Quran Foundation client. The Surah pages are
 * statically prerendered at build time, where no upstream credentials exist and
 * a network call would either fail the build or silently produce 114 empty
 * pages. Everything here is either lifted from ./chapters or derived from it.
 *
 * WHAT IS AND IS NOT IN HERE
 *
 * Only facts that can be stated without interpretation: the name, the Ayah
 * count, where it was revealed, where it sits in the Mushaf, which Juz it
 * spans. There is deliberately no thematic commentary generated per Surah —
 * writing 114 summaries of Qur'anic content from memory is exactly how errors
 * enter religious material, and the terms page commits this site to treating
 * accuracy in Qur'anic matters as the highest priority. The ten `summary`
 * entries below are the ones already written for /surahs and reviewed; the
 * other 104 pages carry facts and tools rather than invented description.
 *
 * REVELATION PLACE
 *
 * The Makki/Madani split follows the same classification as the upstream
 * chapter metadata the rest of the app reads, so the static page and the
 * in-game hint cannot contradict each other. A handful of Surahs are
 * classified differently in different scholarly traditions; where they are,
 * this follows the upstream convention rather than adjudicating between them.
 */

import { CANONICAL_CHAPTERS, TOTAL_SURAHS } from "./chapters";
import { juzForVerseKey } from "./juz";

export type RevelationPlace = "Makkah" | "Madinah";

export type SurahFacts = {
  id: number;
  slug: string;
  nameSimple: string;
  nameArabic: string;
  /** The conventional English rendering of the name. */
  meaning: string;
  versesCount: number;
  revelationPlace: RevelationPlace;
  /** Juz numbers this Surah touches, ascending. Always at least one. */
  juz: number[];
  /** 1 = the longest Surah by Ayah count. Ties share the lower rank. */
  lengthRank: number;
  /** Reviewed description, for the Surahs that have one. */
  summary?: string;
};

/**
 * The 28 Madani Surahs. Everything not listed is Makki.
 *
 * Kept as the short list rather than a value per Surah: the exceptions are what
 * carry information, and a 114-line table of mostly "Makkah" invites a
 * copy-paste error that this shape cannot express.
 */
const MADANI_IDS = new Set([
  2, 3, 4, 5, 8, 9, 13, 22, 24, 33, 47, 48, 49, 55, 57, 58, 59, 60, 61, 62, 63,
  64, 65, 66, 76, 98, 99, 110,
]);

/** Conventional English renderings, by chapter id. */
const MEANINGS: Readonly<Record<number, string>> = {
  1: "The Opening",
  2: "The Cow",
  3: "The Family of Imran",
  4: "The Women",
  5: "The Table Spread",
  6: "The Cattle",
  7: "The Heights",
  8: "The Spoils of War",
  9: "The Repentance",
  10: "Jonah",
  11: "Hud",
  12: "Joseph",
  13: "The Thunder",
  14: "Abraham",
  15: "The Rocky Tract",
  16: "The Bee",
  17: "The Night Journey",
  18: "The Cave",
  19: "Mary",
  20: "Ta-Ha",
  21: "The Prophets",
  22: "The Pilgrimage",
  23: "The Believers",
  24: "The Light",
  25: "The Criterion",
  26: "The Poets",
  27: "The Ant",
  28: "The Stories",
  29: "The Spider",
  30: "The Romans",
  31: "Luqman",
  32: "The Prostration",
  33: "The Combined Forces",
  34: "Sheba",
  35: "The Originator",
  36: "Ya Sin",
  37: "Those Who Set the Ranks",
  38: "Sad",
  39: "The Troops",
  40: "The Forgiver",
  41: "Explained in Detail",
  42: "The Consultation",
  43: "The Ornaments of Gold",
  44: "The Smoke",
  45: "The Kneeling",
  46: "The Curved Sand Hills",
  47: "Muhammad",
  48: "The Victory",
  49: "The Rooms",
  50: "Qaf",
  51: "The Winnowing Winds",
  52: "The Mount",
  53: "The Star",
  54: "The Moon",
  55: "The Most Merciful",
  56: "The Inevitable",
  57: "The Iron",
  58: "The Pleading Woman",
  59: "The Exile",
  60: "She Who Is Tested",
  61: "The Ranks",
  62: "The Congregation",
  63: "The Hypocrites",
  64: "The Mutual Disillusion",
  65: "The Divorce",
  66: "The Prohibition",
  67: "The Sovereignty",
  68: "The Pen",
  69: "The Reality",
  70: "The Ascending Stairways",
  71: "Noah",
  72: "The Jinn",
  73: "The Enshrouded One",
  74: "The Cloaked One",
  75: "The Resurrection",
  76: "Man",
  77: "The Emissaries",
  78: "The Tidings",
  79: "Those Who Drag Forth",
  80: "He Frowned",
  81: "The Overthrowing",
  82: "The Cleaving",
  83: "Those Who Deal in Fraud",
  84: "The Sundering",
  85: "The Mansions of the Stars",
  86: "The Nightcomer",
  87: "The Most High",
  88: "The Overwhelming",
  89: "The Dawn",
  90: "The City",
  91: "The Sun",
  92: "The Night",
  93: "The Morning Hours",
  94: "The Relief",
  95: "The Fig",
  96: "The Clot",
  97: "The Power",
  98: "The Clear Proof",
  99: "The Earthquake",
  100: "The Courser",
  101: "The Calamity",
  102: "The Rivalry in Worldly Increase",
  103: "The Declining Day",
  104: "The Slanderer",
  105: "The Elephant",
  106: "Quraysh",
  107: "The Small Kindnesses",
  108: "The Abundance",
  109: "The Disbelievers",
  110: "The Divine Support",
  111: "The Palm Fibre",
  112: "Sincerity",
  113: "The Daybreak",
  114: "Mankind",
};

/**
 * Descriptions that have already been written and reviewed for /surahs.
 *
 * The single source for both places. A Surah absent from this map simply has no
 * description on its page — which is correct, and better than a generated one.
 */
const SUMMARIES: Readonly<Record<number, string>> = {
  1: "A foundational prayer of praise, guidance, and reliance upon Allah.",
  2: "A wide-ranging Surah on faith, law, worship, guidance, and community life.",
  18: "A Surah of trials, faith, patience, knowledge, and trust in Allah.",
  36: "A powerful reminder of revelation, resurrection, and Allah’s signs in creation.",
  55: "A reflection on Allah’s mercy, blessings, creation, and final judgment.",
  56: "A vivid depiction of the Last Day and the different ranks of humanity.",
  67: "A reflection on Allah’s sovereignty, creation, and human accountability.",
  112: "A concise declaration of Allah’s absolute oneness and uniqueness.",
  113: "A prayer seeking Allah’s protection from harm, darkness, and envy.",
  114: "A prayer seeking Allah’s protection from evil whispers that enter the heart.",
};

/**
 * URL slug from the transliterated name.
 *
 * Derived rather than typed so a slug cannot drift from the name it is supposed
 * to represent. Apostrophes are dropped rather than replaced, because
 * "al-a'raf" would otherwise become "al-a-raf" — two tokens where the name has
 * one. Uniqueness across all 114 is asserted by a test, not assumed.
 */
export function surahSlug(nameSimple: string): string {
  return nameSimple
    .toLowerCase()
    .normalize("NFD")
    // Combining marks, then the apostrophe forms that appear in the names.
    .replace(/[̀-ͯ]/g, "")
    .replace(/['‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Juz numbers a Surah spans, ascending.
 *
 * Only the first and last Ayah need looking up: Juz boundaries are monotonic in
 * (chapter, verse), so a Surah covers exactly the unbroken run between the Juz
 * of its opening Ayah and the Juz of its closing one. Reuses juzForVerseKey
 * rather than re-walking JUZ_STARTS here, so there is one implementation of the
 * boundary rule and the in-game Juz hint cannot disagree with these pages.
 */
function juzForChapter(chapterId: number, versesCount: number): number[] {
  const first = juzForVerseKey(`${chapterId}:1`);
  const last = juzForVerseKey(`${chapterId}:${versesCount}`);
  if (first === null || last === null) return [];

  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
}

function buildFacts(): SurahFacts[] {
  // Rank by Ayah count, descending. Computed once over the whole table so the
  // comparison is against all 114 rather than a hand-maintained top ten.
  const byLength = [...CANONICAL_CHAPTERS]
    .sort((a, b) => b[3] - a[3] || a[0] - b[0])
    .map(([id]) => id);

  return CANONICAL_CHAPTERS.map(([id, nameSimple, nameArabic, versesCount]) => ({
    id,
    slug: surahSlug(nameSimple),
    nameSimple,
    nameArabic,
    meaning: MEANINGS[id] ?? nameSimple,
    versesCount,
    revelationPlace: MADANI_IDS.has(id) ? ("Madinah" as const) : ("Makkah" as const),
    juz: juzForChapter(id, versesCount),
    lengthRank: byLength.indexOf(id) + 1,
    summary: SUMMARIES[id],
  }));
}

export const SURAH_FACTS: readonly SurahFacts[] = buildFacts();

const BY_SLUG = new Map(SURAH_FACTS.map((surah) => [surah.slug, surah]));
const BY_ID = new Map(SURAH_FACTS.map((surah) => [surah.id, surah]));

export function findSurahBySlug(slug: string): SurahFacts | null {
  return BY_SLUG.get(slug.toLowerCase()) ?? null;
}

export function findSurahById(id: number): SurahFacts | null {
  return BY_ID.get(id) ?? null;
}

/** The Surah before and after this one in the Mushaf. */
export function surahNeighbours(id: number) {
  return {
    previous: id > 1 ? findSurahById(id - 1) : null,
    next: id < TOTAL_SURAHS ? findSurahById(id + 1) : null,
  };
}

/** "Juz 15" or "Juz 15–16" or "Juz 1, 2 and 3", as the span requires. */
export function formatJuzSpan(juz: readonly number[]): string {
  if (!juz.length) return "";
  if (juz.length === 1) return `Juz ${juz[0]}`;

  const contiguous = juz.every((value, index) => index === 0 || value === juz[index - 1] + 1);
  if (contiguous) return `Juz ${juz[0]}–${juz[juz.length - 1]}`;

  const head = juz.slice(0, -1).join(", ");
  return `Juz ${head} and ${juz[juz.length - 1]}`;
}

/** The path to this Surah's page. */
export function surahPath(surah: Pick<SurahFacts, "slug">): string {
  return `/surah/${surah.slug}`;
}

/** The path that opens this Surah in the reader. */
export function surahReaderPath(surah: Pick<SurahFacts, "id">): string {
  return `/learning-blocks?surah=${surah.id}`;
}
