import { GAME_MODES } from "@/lib/game/modes";
import { notFound, upstreamError } from "@/lib/http/api-error";
import { chooseTranslation, findChapter, getCatalog } from "@/lib/quran/catalog";
import { qfFetch } from "@/lib/quran/client";
import { cleanQuranArabicForDisplay, cleanTranslationHtml } from "@/lib/quran/text";
import { getStore } from "@/lib/store";
import { contentIndex, slotPosition, type SlotHour } from "@/lib/notifications/schedule";

/**
 * What each notification says.
 *
 * Scripture is never written out in this file. The verse lists below hold only
 * references; the words themselves are resolved at send time through the same
 * Quran Foundation pipeline and the same vetted translation resource the
 * reader sees in the app. That keeps one source of truth for sacred text and
 * means a notification can never quote something the app would not.
 *
 * The one list that does carry words is the adhkar: short remembrances given
 * in transliteration with their meaning, the way a reader would say them. The
 * Arabic and the grading of each live in the source collections the Dhikr
 * page links to, which is where every dhikr notification sends the reader.
 *
 * Every `url` here is a link the app actually honours: the reader takes
 * `?surah=` and `?ayah=`, the game takes `?mode=` and `?variant=`, the Names
 * page takes `?name=`, and the Dhikr page has an id per routine.
 */

export type VerseRef = { chapterId: number; verseNumber: number };

/**
 * Verses for the daily verse notification. Chosen for being widely known and
 * self-contained enough to stand alone in a one-line notification.
 */
export const VERSE_OF_THE_DAY: VerseRef[] = [
  { chapterId: 1, verseNumber: 5 },
  { chapterId: 2, verseNumber: 45 },
  { chapterId: 2, verseNumber: 152 },
  { chapterId: 2, verseNumber: 153 },
  { chapterId: 2, verseNumber: 156 },
  { chapterId: 2, verseNumber: 186 },
  { chapterId: 2, verseNumber: 255 },
  { chapterId: 2, verseNumber: 269 },
  { chapterId: 2, verseNumber: 286 },
  { chapterId: 3, verseNumber: 31 },
  { chapterId: 3, verseNumber: 139 },
  { chapterId: 3, verseNumber: 159 },
  { chapterId: 3, verseNumber: 185 },
  { chapterId: 3, verseNumber: 200 },
  { chapterId: 4, verseNumber: 28 },
  { chapterId: 6, verseNumber: 162 },
  { chapterId: 7, verseNumber: 56 },
  { chapterId: 8, verseNumber: 46 },
  { chapterId: 9, verseNumber: 40 },
  { chapterId: 9, verseNumber: 51 },
  { chapterId: 11, verseNumber: 6 },
  { chapterId: 11, verseNumber: 115 },
  { chapterId: 13, verseNumber: 11 },
  { chapterId: 13, verseNumber: 28 },
  { chapterId: 14, verseNumber: 7 },
  { chapterId: 15, verseNumber: 9 },
  { chapterId: 16, verseNumber: 18 },
  { chapterId: 16, verseNumber: 97 },
  { chapterId: 16, verseNumber: 128 },
  { chapterId: 17, verseNumber: 82 },
  { chapterId: 18, verseNumber: 46 },
  { chapterId: 20, verseNumber: 114 },
  { chapterId: 21, verseNumber: 35 },
  { chapterId: 21, verseNumber: 107 },
  { chapterId: 24, verseNumber: 35 },
  { chapterId: 25, verseNumber: 63 },
  { chapterId: 29, verseNumber: 69 },
  { chapterId: 30, verseNumber: 21 },
  { chapterId: 33, verseNumber: 41 },
  { chapterId: 39, verseNumber: 53 },
  { chapterId: 40, verseNumber: 60 },
  { chapterId: 41, verseNumber: 33 },
  { chapterId: 41, verseNumber: 34 },
  { chapterId: 47, verseNumber: 7 },
  { chapterId: 49, verseNumber: 13 },
  { chapterId: 50, verseNumber: 16 },
  { chapterId: 51, verseNumber: 56 },
  { chapterId: 55, verseNumber: 13 },
  { chapterId: 57, verseNumber: 4 },
  { chapterId: 64, verseNumber: 11 },
  { chapterId: 65, verseNumber: 3 },
  { chapterId: 67, verseNumber: 2 },
  { chapterId: 93, verseNumber: 5 },
  { chapterId: 94, verseNumber: 6 },
  { chapterId: 99, verseNumber: 7 },
  { chapterId: 103, verseNumber: 3 },
];

/**
 * Duas drawn from the Qur'an itself, so the same resolver serves them and the
 * wording carries the same provenance as everything else in the app.
 *
 * Chosen so the supplication sits inside the first 160 characters of the
 * Ayah, which is where `condense` cuts a notification body. A dua that begins
 * a long Ayah's closing clause — 2:286, 40:7, 66:8 — is complete on the page
 * but arrives in the tray as its preamble with the prayer cut off, and one
 * that continues from the Ayah before it opens mid-sentence. Both kinds are
 * left to the reader.
 */
export const QURANIC_DUAS: VerseRef[] = [
  { chapterId: 1, verseNumber: 6 },
  { chapterId: 2, verseNumber: 127 },
  { chapterId: 2, verseNumber: 201 },
  { chapterId: 3, verseNumber: 8 },
  { chapterId: 3, verseNumber: 9 },
  { chapterId: 3, verseNumber: 16 },
  { chapterId: 3, verseNumber: 38 },
  { chapterId: 3, verseNumber: 53 },
  { chapterId: 3, verseNumber: 147 },
  { chapterId: 3, verseNumber: 194 },
  { chapterId: 7, verseNumber: 23 },
  { chapterId: 7, verseNumber: 47 },
  { chapterId: 7, verseNumber: 151 },
  { chapterId: 9, verseNumber: 129 },
  { chapterId: 10, verseNumber: 85 },
  { chapterId: 10, verseNumber: 86 },
  { chapterId: 14, verseNumber: 35 },
  { chapterId: 14, verseNumber: 40 },
  { chapterId: 14, verseNumber: 41 },
  { chapterId: 17, verseNumber: 24 },
  { chapterId: 17, verseNumber: 80 },
  { chapterId: 17, verseNumber: 111 },
  { chapterId: 18, verseNumber: 10 },
  { chapterId: 18, verseNumber: 24 },
  { chapterId: 20, verseNumber: 114 },
  { chapterId: 21, verseNumber: 83 },
  { chapterId: 21, verseNumber: 89 },
  { chapterId: 23, verseNumber: 29 },
  { chapterId: 23, verseNumber: 109 },
  { chapterId: 23, verseNumber: 118 },
  { chapterId: 25, verseNumber: 65 },
  { chapterId: 25, verseNumber: 74 },
  { chapterId: 26, verseNumber: 83 },
  { chapterId: 28, verseNumber: 16 },
  { chapterId: 28, verseNumber: 17 },
  { chapterId: 28, verseNumber: 21 },
  { chapterId: 28, verseNumber: 22 },
  { chapterId: 28, verseNumber: 24 },
  { chapterId: 29, verseNumber: 30 },
  { chapterId: 37, verseNumber: 100 },
  { chapterId: 38, verseNumber: 35 },
  { chapterId: 54, verseNumber: 10 },
  { chapterId: 60, verseNumber: 5 },
  { chapterId: 71, verseNumber: 28 },
];

/** Short Surahs the recitation nudge rotates through. */
export const RECITATION_SUGGESTIONS: number[] = [
  1, 32, 36, 50, 55, 56, 62, 67, 73, 76, 78, 80, 81, 82, 84, 85, 86, 87, 88, 89,
  90, 91, 92, 93, 94, 95, 96, 97, 99, 100, 101, 102, 103, 105, 106, 107, 108, 109,
  110, 112, 113, 114,
];

/**
 * The moment of day a dhikr belongs to. `any` fits every slot; the others are
 * offered only in the slots that match, so a dhikr for sleep never arrives
 * mid-morning.
 */
export type DhikrMoment = "any" | "waking" | "morning" | "leaving" | "salah" | "evening" | "sleep";

export type Dhikr = {
  transliteration: string;
  meaning: string;
  moment: DhikrMoment;
};

/**
 * Standard adhkar, in transliteration with their meaning.
 *
 * Kept to the short, universally recited forms. The four tasbih phrases and
 * the istighfar fit anywhere; the rest come from the morning, evening,
 * waking, sleep, after-prayer and leaving-home sets of Hisn al-Muslim, which
 * the Dhikr page links to under the matching routine.
 */
export const ADHKAR: readonly Dhikr[] = [
  { transliteration: "SubhanAllah", meaning: "Glory be to Allah.", moment: "any" },
  { transliteration: "Alhamdulillah", meaning: "All praise is due to Allah.", moment: "any" },
  { transliteration: "Allahu Akbar", meaning: "Allah is the Greatest.", moment: "any" },
  { transliteration: "La ilaha illallah", meaning: "There is no god but Allah.", moment: "any" },
  { transliteration: "Astaghfirullah", meaning: "I seek the forgiveness of Allah.", moment: "any" },
  { transliteration: "SubhanAllahi wa bihamdihi", meaning: "Glory be to Allah, and praise be to Him.", moment: "any" },
  { transliteration: "SubhanAllahil-'Azim", meaning: "Glory be to Allah, the Magnificent.", moment: "any" },
  { transliteration: "La hawla wa la quwwata illa billah", meaning: "There is no power and no strength except with Allah.", moment: "any" },
  { transliteration: "Allahumma salli 'ala Muhammad", meaning: "O Allah, send blessings upon Muhammad.", moment: "any" },
  { transliteration: "Astaghfirullaha wa atubu ilayh", meaning: "I seek the forgiveness of Allah and turn to Him in repentance.", moment: "any" },
  { transliteration: "SubhanAllahi wal-hamdu lillahi wa la ilaha illallahu wallahu akbar", meaning: "Glory be to Allah, all praise is due to Allah, there is no god but Allah, and Allah is the Greatest.", moment: "any" },
  { transliteration: "Allahumma innaka 'afuwwun tuhibbul-'afwa fa'fu 'anni", meaning: "O Allah, You are Most Forgiving and You love forgiveness, so forgive me.", moment: "any" },
  { transliteration: "Allahumma inni as'alukal-huda wat-tuqa wal-'afafa wal-ghina", meaning: "O Allah, I ask You for guidance, piety, chastity and contentment.", moment: "any" },
  { transliteration: "Rabbighfir li", meaning: "My Lord, forgive me.", moment: "any" },
  { transliteration: "Alhamdu lillahil-ladhi ahyana ba'da ma amatana wa ilayhin-nushur", meaning: "All praise is for Allah, who gave us life after having caused us to die, and to Him is the return.", moment: "waking" },
  { transliteration: "Asbahna wa asbahal-mulku lillah", meaning: "We have reached the morning, and the dominion belongs to Allah.", moment: "morning" },
  { transliteration: "Allahumma bika asbahna wa bika amsayna", meaning: "O Allah, by You we enter the morning, and by You we enter the evening.", moment: "morning" },
  { transliteration: "Allahumma inni as'aluka 'ilman nafi'an wa rizqan tayyiban wa 'amalan mutaqabbala", meaning: "O Allah, I ask You for beneficial knowledge, good provision and accepted deeds.", moment: "morning" },
  { transliteration: "Raditu billahi Rabba, wa bil-Islami dina, wa bi-Muhammadin nabiyya", meaning: "I am pleased with Allah as my Lord, Islam as my religion, and Muhammad as my Prophet.", moment: "morning" },
  { transliteration: "Ya Hayyu ya Qayyum, bi-rahmatika astaghith", meaning: "O Ever-Living, O Sustainer, by Your mercy I seek relief.", moment: "morning" },
  { transliteration: "Bismillahi tawakkaltu 'alallah, wa la hawla wa la quwwata illa billah", meaning: "In the name of Allah, I place my trust in Allah, and there is no power and no strength except with Allah.", moment: "leaving" },
  { transliteration: "Allahumma a'inni 'ala dhikrika wa shukrika wa husni 'ibadatik", meaning: "O Allah, help me to remember You, to thank You, and to worship You well.", moment: "salah" },
  { transliteration: "Allahumma antas-salam wa minkas-salam, tabarakta ya dhal-jalali wal-ikram", meaning: "O Allah, You are Peace and from You comes peace; blessed are You, Owner of majesty and honour.", moment: "salah" },
  { transliteration: "Amsayna wa amsal-mulku lillah", meaning: "We have reached the evening, and the dominion belongs to Allah.", moment: "evening" },
  { transliteration: "Allahumma bika amsayna wa bika asbahna", meaning: "O Allah, by You we enter the evening, and by You we enter the morning.", moment: "evening" },
  { transliteration: "A'udhu bikalimatillahit-tammati min sharri ma khalaq", meaning: "I seek refuge in the perfect words of Allah from the evil of what He has created.", moment: "evening" },
  { transliteration: "Bismika Allahumma amutu wa ahya", meaning: "In Your name, O Allah, I die and I live.", moment: "sleep" },
  { transliteration: "Allahumma qini 'adhabaka yawma tab'athu 'ibadak", meaning: "O Allah, protect me from Your punishment on the day You resurrect Your servants.", moment: "sleep" },
];

/**
 * Which moments fit each four-hour slot, in the reader's local time. The
 * small-hours slots are quiet, so the waking dhikr rides with the morning.
 */
const SLOT_MOMENTS: Record<SlotHour, readonly DhikrMoment[]> = {
  0: ["sleep", "any"],
  4: ["waking", "morning", "any"],
  8: ["waking", "morning", "leaving", "any"],
  12: ["salah", "any"],
  16: ["evening", "salah", "any"],
  20: ["evening", "sleep", "any"],
};

/** The routine on the Dhikr page each moment belongs to. Ids match that page. */
const MOMENT_ROUTINE: Record<DhikrMoment, string | null> = {
  any: null,
  waking: "sleep-waking",
  sleep: "sleep-waking",
  morning: "morning-evening",
  evening: "morning-evening",
  leaving: "travel-leaving-home",
  salah: "after-salah",
};

const MOMENT_TITLE: Record<DhikrMoment, string> = {
  any: "A dhikr for now",
  waking: "A dhikr on waking",
  morning: "A morning dhikr",
  leaving: "A dhikr for leaving home",
  salah: "A dhikr after salah",
  evening: "An evening dhikr",
  sleep: "A dhikr before sleep",
};

/**
 * The dhikr for a slot: one of those that fit the moment, stepping through
 * them slot by slot so consecutive dhikr slots do not repeat.
 */
export function dhikrForSlot(localDay: string, slot: SlotHour): Dhikr {
  const moments = SLOT_MOMENTS[slot] ?? ["any"];
  const eligible = ADHKAR.filter((dhikr) => moments.includes(dhikr.moment));
  const pool = eligible.length ? eligible : ADHKAR;
  return pool[contentIndex(localDay, slot, pool.length)];
}

/**
 * What the dua slot carries, in turn: a Qur'anic dua, then a dhikr, then one
 * of the 99 Names. Six slots a day means two of each. To change the balance,
 * change this list; nothing else needs to know.
 */
export const DUA_SLOT_KINDS = ["dua", "dhikr", "name"] as const;

export type DuaSlotKind = (typeof DUA_SLOT_KINDS)[number];

export type DuaSlotPick =
  | { kind: "dua"; ref: VerseRef }
  | { kind: "dhikr"; dhikr: Dhikr }
  | { kind: "name"; number: number };

/**
 * Which remembrance a slot gets. The kind cycles with the slot; the item
 * within a kind advances each time that kind comes round, so every dua, every
 * dhikr and every Name is reached in order rather than the same few recurring.
 */
export function duaSlotPick(localDay: string, slot: SlotHour): DuaSlotPick {
  const position = slotPosition(localDay, slot);
  const kind = DUA_SLOT_KINDS[position % DUA_SLOT_KINDS.length];
  const turn = Math.floor(position / DUA_SLOT_KINDS.length);

  if (kind === "dhikr") return { kind, dhikr: dhikrForSlot(localDay, slot) };
  if (kind === "name") return { kind, number: (turn % 99) + 1 };
  return { kind: "dua", ref: QURANIC_DUAS[turn % QURANIC_DUAS.length] };
}

/**
 * The game modes the midday reminder rotates through, one entry per playable
 * rules set. Derived from the registry, so a new mode joins the rotation
 * without anyone remembering to add it here.
 */
export const PLAY_SUGGESTIONS: ReadonlyArray<{
  modeId: string;
  variantId?: string;
  title: string;
  tagline: string;
}> = GAME_MODES.flatMap((mode) =>
  mode.variants?.length
    ? mode.variants.map((variant) => ({
        modeId: mode.id,
        variantId: variant.id,
        title: `${mode.name} · ${variant.name}`,
        tagline: variant.tagline,
      }))
    : [{ modeId: mode.id, title: mode.name, tagline: mode.tagline }],
);

export type ResolvedVerse = {
  chapterId: number;
  verseNumber: number;
  verseKey: string;
  chapterName: string;
  arabic: string;
  translation: string;
};

/**
 * Resolved verses are cached for a day.
 *
 * A dispatch touches at most a handful of distinct references but may fan out
 * to thousands of subscribers, so without this the upstream would see one
 * request per subscriber for the same Ayah.
 */
const RESOLVED_TTL_MS = 24 * 60 * 60_000;

function resolvedKey(ref: VerseRef, language: string) {
  return `notif:verse:${ref.chapterId}:${ref.verseNumber}:${language}`;
}

type ApiVerse = {
  chapter_id: number;
  verse_number: number;
  verse_key: string;
  text_uthmani?: string;
  translations?: Array<{ resource_id: number; text: string }>;
};

function versePath(ref: VerseRef, translationId: number) {
  const params = new URLSearchParams({
    page: String(ref.verseNumber),
    per_page: "1",
    words: "false",
    fields: "chapter_id,text_uthmani",
    translations: String(translationId),
    translation_fields: "resource_name,language_name",
  });
  return `/verses/by_chapter/${ref.chapterId}?${params.toString()}`;
}

export async function resolveVerse(ref: VerseRef, language = "english"): Promise<ResolvedVerse> {
  const store = getStore();
  const cacheKey = resolvedKey(ref, language);

  const cached = await store.get<ResolvedVerse>(cacheKey);
  if (cached) return cached;

  const catalog = await getCatalog();
  const chapter = findChapter(catalog, ref.chapterId);
  if (!chapter) throw notFound(`Surah ${ref.chapterId} is not in the catalog.`);

  const translation = chooseTranslation(catalog.translations, language)
    ?? chooseTranslation(catalog.translations, "english");
  if (!translation) throw notFound("No translation resource is available right now.");

  const response = await qfFetch<{ verses: ApiVerse[] }>(versePath(ref, translation.id));
  const verse = response.verses?.[0];

  if (!verse || verse.chapter_id !== ref.chapterId || verse.verse_number !== ref.verseNumber) {
    throw upstreamError(
      `Quran Foundation returned an unexpected Ayah for ${ref.chapterId}:${ref.verseNumber}.`,
    );
  }

  const resolved: ResolvedVerse = {
    chapterId: verse.chapter_id,
    verseNumber: verse.verse_number,
    verseKey: verse.verse_key,
    chapterName: chapter.name_simple,
    arabic: cleanQuranArabicForDisplay(verse.text_uthmani),
    translation: cleanTranslationHtml(
      verse.translations?.find((item) => item.resource_id === translation.id)?.text ?? "",
    ),
  };

  await store.set(cacheKey, resolved, RESOLVED_TTL_MS);
  return resolved;
}

/**
 * A Surah's name from the same catalog the reader sees. No verse fetch: the
 * recitation nudge names whichever Surah each reader left off in, so a fetch
 * per reader would fan out to every Surah in the Qur'an.
 */
export async function resolveChapterName(chapterId: number): Promise<string> {
  const chapter = findChapter(await getCatalog(), chapterId);
  if (!chapter) throw notFound(`Surah ${chapterId} is not in the catalog.`);
  return chapter.name_simple;
}

/** Trim a translation to something that survives a notification tray. */
export function condense(text: string, maxLength = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLength) return flat;
  const cut = flat.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export type NotificationContent = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

/** The reader, opened at a Surah — and, when given, scrolled to one Ayah. */
export function readerUrl(chapterId: number, verseNumber?: number): string {
  const base = `/learning-blocks?surah=${chapterId}`;
  return verseNumber ? `${base}&ayah=${verseNumber}` : base;
}

export function streakContent(streak: number): NotificationContent {
  return {
    title: streak === 1 ? "Keep your streak going" : `Your ${streak}-day streak is waiting`,
    body: "A few Ayahs today is enough to keep it alive.",
    url: "/learning-blocks",
    tag: "streak",
  };
}

/**
 * The afternoon nudge names the Surah the reader last left off in, and the
 * link resumes their saved place in it. `fromRotation` is the fallback for a
 * device that has not read anything yet, where there is nothing to reconnect
 * with, so the wording changes to a plain suggestion.
 */
export function recitationContent(
  chapterName: string,
  chapterId: number,
  fromRotation = false,
): NotificationContent {
  return {
    title: fromRotation ? "Time to listen" : "Reconnect with",
    body: fromRotation
      ? `Sit with Surah ${chapterName} for a few minutes.`
      : `Surah ${chapterName} for a few minutes.`,
    url: readerUrl(chapterId),
    tag: "recitation",
  };
}

export function verseContent(verse: ResolvedVerse): NotificationContent {
  return {
    title: `${verse.chapterName} ${verse.verseNumber}`,
    body: condense(verse.translation),
    url: readerUrl(verse.chapterId, verse.verseNumber),
    tag: "verse",
  };
}

export function duaContent(verse: ResolvedVerse): NotificationContent {
  return {
    title: "A dua for now",
    body: condense(verse.translation),
    url: readerUrl(verse.chapterId, verse.verseNumber),
    tag: "dua",
  };
}

/** Shares the dua slot's tag: a newer remembrance replaces the last, whatever kind it was. */
export function dhikrContent(dhikr: Dhikr): NotificationContent {
  const routine = MOMENT_ROUTINE[dhikr.moment];
  return {
    title: MOMENT_TITLE[dhikr.moment],
    body: `${dhikr.transliteration} — ${dhikr.meaning}`,
    url: routine ? `/dhikr-duas#${routine}` : "/dhikr-duas",
    tag: "dua",
  };
}

export function nameContent(name: { number: number; transliteration: string; meaning: string }): NotificationContent {
  return {
    title: "A Name of Allah",
    body: `${name.transliteration} — ${name.meaning}`,
    url: `/names-of-allah?name=${name.number}`,
    tag: "dua",
  };
}

export function playContent(suggestion: (typeof PLAY_SUGGESTIONS)[number]): NotificationContent {
  const params = new URLSearchParams({ mode: suggestion.modeId });
  if (suggestion.variantId) params.set("variant", suggestion.variantId);
  return {
    title: suggestion.title,
    body: suggestion.tagline,
    url: `/?${params.toString()}`,
    tag: "play",
  };
}
