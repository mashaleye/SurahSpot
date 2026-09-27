/**
 * A deterministic stand-in for the Quran Foundation API.
 *
 * This exists so the e2e suite, CI, and offline development can play complete
 * seven-round attempts without credentials, without network access, and without
 * burning upstream quota on every test run. It is enabled by QF_MOCK=1 and
 * refused when NODE_ENV=production (see config/env.ts), so it cannot leak into
 * a real deploy.
 *
 * It answers the same paths the real client calls, with the same response
 * shapes, including the awkward parts worth testing against: a reciter that
 * covers chapters but publishes no word segments, a reciter that 404s for some
 * chapters, and segments deliberately returned out of order so the
 * normalization path is exercised rather than assumed.
 */

import type { Segment } from "./karaoke";

export const MOCK_AUDIO_HOST = "https://mock-audio.quran.invalid";

type MockChapter = {
  id: number;
  name_simple: string;
  name_arabic: string;
  verses_count: number;
  revelation_place: string;
  translated_name: { language_name: string; name: string };
};

const MOCK_CHAPTERS: MockChapter[] = [
  { id: 1, name_simple: "Al-Fatihah", name_arabic: "الفاتحة", verses_count: 7, revelation_place: "makkah", translated_name: { language_name: "english", name: "The Opener" } },
  { id: 2, name_simple: "Al-Baqarah", name_arabic: "البقرة", verses_count: 286, revelation_place: "madinah", translated_name: { language_name: "english", name: "The Cow" } },
  { id: 36, name_simple: "Ya-Sin", name_arabic: "يس", verses_count: 83, revelation_place: "makkah", translated_name: { language_name: "english", name: "Ya Sin" } },
  { id: 55, name_simple: "Ar-Rahman", name_arabic: "الرحمن", verses_count: 78, revelation_place: "madinah", translated_name: { language_name: "english", name: "The Most Merciful" } },
  { id: 67, name_simple: "Al-Mulk", name_arabic: "الملك", verses_count: 30, revelation_place: "makkah", translated_name: { language_name: "english", name: "The Sovereignty" } },
  { id: 108, name_simple: "Al-Kawthar", name_arabic: "الكوثر", verses_count: 3, revelation_place: "makkah", translated_name: { language_name: "english", name: "The Abundance" } },
  { id: 112, name_simple: "Al-Ikhlas", name_arabic: "الإخلاص", verses_count: 4, revelation_place: "makkah", translated_name: { language_name: "english", name: "The Sincerity" } },
  { id: 113, name_simple: "Al-Falaq", name_arabic: "الفلق", verses_count: 5, revelation_place: "makkah", translated_name: { language_name: "english", name: "The Daybreak" } },
  { id: 114, name_simple: "An-Nas", name_arabic: "الناس", verses_count: 6, revelation_place: "makkah", translated_name: { language_name: "english", name: "Mankind" } },
];

const MOCK_RECITERS = [
  // Covers everything and publishes segments. The default happy path.
  { id: 7, name: "Mishari Rashid al-Afasy", style: { name: "Murattal" } },
  // Covers everything but returns no segments: exercises the fallback that
  // ranks reciters by whether they actually publish word timing.
  { id: 3, name: "Untimed Reciter (fixture)", style: { name: "Murattal" } },
  // 404s for anything above chapter 100: exercises per-chapter coverage gaps.
  { id: 4, name: "Partial Coverage Reciter (fixture)", style: { name: "Mujawwad" } },
];

const MOCK_TRANSLATIONS = [
  { id: 131, name: "Dr. Mustafa Khattab, The Clear Quran", author_name: "Mustafa Khattab", slug: "clear-quran", language_name: "english" },
  { id: 57, name: "Transliteration", author_name: "Transliteration", slug: "transliteration", language_name: "english" },
  { id: 136, name: "Le Saint Coran", author_name: "Muhammad Hamidullah", slug: "hamidullah", language_name: "french" },
  { id: 234, name: "Bayan-ul-Quran", author_name: "Israr Ahmad", slug: "bayan", language_name: "urdu" },
];

const ARABIC_WORDS = ["بِسْمِ", "ٱللَّهِ", "ٱلرَّحْمَٰنِ", "ٱلرَّحِيمِ", "ٱلْحَمْدُ", "لِلَّهِ", "رَبِّ", "ٱلْعَٰلَمِينَ"];

function wordCountFor(chapterId: number, verseNumber: number) {
  return 4 + ((chapterId * 7 + verseNumber * 3) % 5);
}

/** Segments for one ayah, intentionally shuffled to exercise normalization. */
function segmentsFor(chapterId: number, verseNumber: number): Segment[] {
  const count = wordCountFor(chapterId, verseNumber);
  const base = (chapterId * 100_000) + (verseNumber * 4_000);
  const segments: Segment[] = [];
  for (let position = 1; position <= count; position += 1) {
    const start = base + (position - 1) * 600;
    // A gap after word 2 gives the "silence between segments" case real data.
    const gap = position > 2 ? 120 : 0;
    segments.push([position, start + gap, start + gap + 480]);
  }
  if (segments.length > 2) {
    const [first, ...rest] = segments;
    return [...rest.reverse(), first];
  }
  return segments;
}

function timingFor(chapterId: number, verseNumber: number) {
  const segments = segmentsFor(chapterId, verseNumber).slice().sort((a, b) => a[1] - b[1]);
  return {
    verse_key: `${chapterId}:${verseNumber}`,
    timestamp_from: segments[0][1] - 50,
    timestamp_to: segments[segments.length - 1][2] + 50,
    duration: segments[segments.length - 1][2] - segments[0][1] + 100,
    segments: segmentsFor(chapterId, verseNumber),
  };
}

function chapterFor(chapterId: number) {
  return MOCK_CHAPTERS.find((chapter) => chapter.id === chapterId);
}

class MockUpstreamError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "MockUpstreamError";
  }
}

export function mockSearch(query: string) {
  const normalized = query.trim().toLowerCase();
  const navigation = MOCK_CHAPTERS
    .filter((chapter) =>
      chapter.name_simple.toLowerCase().includes(normalized) ||
      chapter.translated_name.name.toLowerCase().includes(normalized) ||
      chapter.name_arabic.includes(query.trim()) ||
      String(chapter.id) === normalized)
    .map((chapter) => ({ result_type: "surah" as const, key: chapter.id, name: chapter.name_simple }));

  return {
    result: {
      navigation,
      // Deliberately populated. The search route must filter these out, and a
      // fixture that never returns them would let that regression ship.
      verses: [{ result_type: "ayah" as const, key: "2:255", name: "Ayat al-Kursi" }],
    },
  };
}

/**
 * Route a QF content path to fixture data.
 * Throws MockUpstreamError with a realistic status for the failure cases.
 */
export function mockContentRequest(path: string): unknown {
  const [pathname, rawQuery = ""] = path.split("?");
  const query = new URLSearchParams(rawQuery);

  if (pathname.startsWith("/chapters")) {
    return { chapters: MOCK_CHAPTERS };
  }

  if (pathname.startsWith("/resources/translations")) {
    return { translations: MOCK_TRANSLATIONS };
  }

  if (pathname.startsWith("/resources/chapter_reciters")) {
    return { reciters: MOCK_RECITERS };
  }

  const recitation = pathname.match(/^\/chapter_recitations\/(\d+)\/(\d+)$/);
  if (recitation) {
    const reciterId = Number(recitation[1]);
    const chapterId = Number(recitation[2]);
    if (!chapterFor(chapterId)) throw new MockUpstreamError(404, "Chapter not found");
    if (reciterId === 4 && chapterId > 100) throw new MockUpstreamError(404, "Reciter does not cover this chapter");

    const chapter = chapterFor(chapterId)!;
    // Reciter 3 returns audio with no timing data at all.
    const timestamps = reciterId === 3
      ? []
      : Array.from({ length: Math.min(chapter.verses_count, 12) }, (_, index) => timingFor(chapterId, index + 1));

    return {
      audio_file: {
        id: reciterId * 1000 + chapterId,
        chapter_id: chapterId,
        format: "mp3",
        audio_url: `${MOCK_AUDIO_HOST}/${reciterId}/${chapterId}.mp3`,
        timestamps,
      },
    };
  }


  const byPage = pathname.match(/^\/verses\/by_page\/(\d+)$/);
  if (byPage) {
    const pageNumber = Number(byPage[1]);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 604) {
      throw new MockUpstreamError(404, "Page not found");
    }

    const requested = (query.get("translations") ?? "").split(",").map(Number);
    const chapter = pageNumber === 1
      ? chapterFor(1)!
      : MOCK_CHAPTERS[(pageNumber - 2) % MOCK_CHAPTERS.length];
    const start = pageNumber === 1 ? 1 : (((pageNumber - 2) * 5) % chapter.verses_count) + 1;
    const count = Math.min(pageNumber === 1 ? 7 : 5, chapter.verses_count - start + 1);
    const juzNumber = Math.min(30, Math.max(1, Math.ceil(pageNumber / (604 / 30))));
    const hizbNumber = Math.min(60, Math.max(1, Math.ceil(pageNumber / (604 / 60))));

    return {
      verses: Array.from({ length: count }, (_, offset) => {
        const verseNumber = start + offset;
        const words = Array.from({ length: wordCountFor(chapter.id, verseNumber) }, (_, index) => ({
          id: index + 1,
          position: index + 1,
          text_uthmani: ARABIC_WORDS[index % ARABIC_WORDS.length],
          char_type_name: "word",
        }));
        const translations = MOCK_TRANSLATIONS
          .filter((translation) => requested.includes(translation.id))
          .map((translation) => ({
            resource_id: translation.id,
            resource_name: translation.name,
            language_name: translation.language_name,
            text: `Fixture translation of ${chapter.name_simple} verse ${verseNumber}.`,
          }));
        return {
          id: chapter.id * 1000 + verseNumber,
          chapter_id: chapter.id,
          verse_number: verseNumber,
          verse_key: `${chapter.id}:${verseNumber}`,
          page_number: pageNumber,
          juz_number: juzNumber,
          hizb_number: hizbNumber,
          text_uthmani: words.map((word) => word.text_uthmani).join(" "),
          translations,
        };
      }),
    };
  }

  const byChapter = pathname.match(/^\/verses\/by_chapter\/(\d+)$/);
  if (byChapter) {
    const chapterId = Number(byChapter[1]);
    const chapter = chapterFor(chapterId);
    if (!chapter) throw new MockUpstreamError(404, "Chapter not found");

    const page = Math.max(1, Number(query.get("page") ?? "1"));
    const perPage = Math.max(1, Number(query.get("per_page") ?? "10"));
    const totalPages = Math.max(1, Math.ceil(chapter.verses_count / perPage));
    if (page > totalPages) throw new MockUpstreamError(404, "Verse page not found");

    const firstVerse = ((page - 1) * perPage) + 1;
    const lastVerse = Math.min(chapter.verses_count, firstVerse + perPage - 1);
    const requested = (query.get("translations") ?? "").split(",").map(Number);

    const verses = Array.from({ length: lastVerse - firstVerse + 1 }, (_, offset) => {
      const verseNumber = firstVerse + offset;
      const count = wordCountFor(chapterId, verseNumber);
      const words = Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        position: index + 1,
        text_uthmani: ARABIC_WORDS[index % ARABIC_WORDS.length],
        char_type_name: "word",
      }));
      words.push({ id: count + 1, position: count + 1, text_uthmani: "\u06dd", char_type_name: "end" });

      const translations = MOCK_TRANSLATIONS
        .filter((translation) => requested.includes(translation.id))
        .map((translation) => ({
          resource_id: translation.id,
          resource_name: translation.name,
          language_name: translation.language_name,
          text: translation.id === 57
            ? `bismi <sup foot_note="1">1</sup>l-lahi r-rahmani verse ${verseNumber}`
            : `Fixture translation of ${chapter.name_simple} verse ${verseNumber}.<br>Second line.`,
        }));

      const pageNumber = chapterId === 1
        ? 1
        : Math.min(604, 2 + ((chapterId - 2) * 5) + Math.floor((verseNumber - 1) / 5));
      const juzNumber = Math.min(30, Math.max(1, Math.ceil(pageNumber / (604 / 30))));
      const hizbNumber = Math.min(60, Math.max(1, Math.ceil(pageNumber / (604 / 60))));

      return {
        id: chapterId * 1000 + verseNumber,
        chapter_id: chapterId,
        verse_number: verseNumber,
        verse_key: `${chapterId}:${verseNumber}`,
        page_number: pageNumber,
        juz_number: juzNumber,
        hizb_number: hizbNumber,
        text_uthmani: words.filter((word) => word.char_type_name === "word").map((word) => word.text_uthmani).join(" "),
        words,
        translations,
      };
    });

    return {
      verses,
      pagination: {
        current_page: page,
        next_page: page < totalPages ? page + 1 : null,
        per_page: perPage,
        total_pages: totalPages,
        total_records: chapter.verses_count,
      },
    };
  }

  const byJuz = pathname.match(/^\/verses\/by_juz\/(\d+)$/);
  if (byJuz) {
    const juzNumber = Number(byJuz[1]);
    if (!Number.isInteger(juzNumber) || juzNumber < 1 || juzNumber > 30) {
      throw new MockUpstreamError(404, "Juz not found");
    }
    const pageNumber = 1 + Math.floor((juzNumber - 1) * (604 / 30));
    const chapter = pageNumber === 1
      ? chapterFor(1)!
      : MOCK_CHAPTERS[(juzNumber - 1) % MOCK_CHAPTERS.length];
    return {
      verses: [{
        id: chapter.id * 1000 + 1,
        chapter_id: chapter.id,
        verse_number: 1,
        verse_key: `${chapter.id}:1`,
        page_number: pageNumber,
        juz_number: juzNumber,
        hizb_number: Math.min(60, ((juzNumber - 1) * 2) + 1),
        text_uthmani: ARABIC_WORDS.slice(0, 4).join(" "),
        translations: [],
      }],
    };
  }

  const singleTranslation = pathname.match(/^\/quran\/translations\/(\d+)$/);
  if (singleTranslation) {
    const resourceId = Number(singleTranslation[1]);
    const verseKey = query.get("verse_key") ?? "1:1";
    const translation = MOCK_TRANSLATIONS.find((item) => item.id === resourceId);
    if (!translation) throw new MockUpstreamError(404, "Translation resource not found");
    return { translations: [{ text: `Fixture ${translation.language_name} translation for ${verseKey}.` }] };
  }

  throw new MockUpstreamError(404, `No fixture for ${pathname}`);
}

export { MockUpstreamError };
