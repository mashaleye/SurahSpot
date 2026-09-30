import { describe, expect, it } from "vitest";

import { GAME_MODES } from "@/lib/game/modes";
import {
  ADHKAR,
  DUA_SLOT_KINDS,
  PLAY_SUGGESTIONS,
  QURANIC_DUAS,
  RECITATION_SUGGESTIONS,
  VERSE_OF_THE_DAY,
  dhikrContent,
  dhikrForSlot,
  duaSlotPick,
  nameContent,
  playContent,
  readerUrl,
  recitationContent,
  streakContent,
  type VerseRef,
} from "@/lib/notifications/content";
import { ACTIVE_SLOTS, QUIET_SLOTS, SLOT_HOURS, type SlotHour } from "@/lib/notifications/schedule";
import { CANONICAL_CHAPTERS } from "@/lib/quran/chapters";

/**
 * The reminder lists hold references, not text: each one is resolved against
 * Quran Foundation at send time. A reference that points past the end of its
 * Surah fails to resolve, and a mistyped one resolves to the wrong Ayah under
 * a "dua" title. Neither shows up until a reader's slot comes round, so the
 * references are checked here against the canonical Ayah counts.
 */

const versesIn = new Map(CANONICAL_CHAPTERS.map(([id, , , versesCount]) => [id, versesCount]));

function keyOf(ref: VerseRef) {
  return `${ref.chapterId}:${ref.verseNumber}`;
}

describe.each([
  ["QURANIC_DUAS", QURANIC_DUAS],
  ["VERSE_OF_THE_DAY", VERSE_OF_THE_DAY],
])("%s", (_name, list) => {
  it("points only at Ayahs that exist", () => {
    for (const ref of list) {
      const count = versesIn.get(ref.chapterId);
      expect(count, `Surah ${ref.chapterId} should exist`).toBeDefined();
      expect(Number.isInteger(ref.verseNumber), keyOf(ref)).toBe(true);
      expect(ref.verseNumber, keyOf(ref)).toBeGreaterThanOrEqual(1);
      expect(ref.verseNumber, keyOf(ref)).toBeLessThanOrEqual(count ?? 0);
    }
  });

  it("lists each Ayah once", () => {
    const keys = list.map(keyOf);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stays in Mushaf order, so a duplicate or a gap is easy to spot in review", () => {
    const sorted = [...list].sort((a, b) => a.chapterId - b.chapterId || a.verseNumber - b.verseNumber);
    expect(list.map(keyOf)).toEqual(sorted.map(keyOf));
  });
});

describe("RECITATION_SUGGESTIONS", () => {
  it("names only real Surahs, each once, in order", () => {
    for (const id of RECITATION_SUGGESTIONS) {
      expect(versesIn.has(id), `Surah ${id}`).toBe(true);
    }
    expect(new Set(RECITATION_SUGGESTIONS).size).toBe(RECITATION_SUGGESTIONS.length);
    expect(RECITATION_SUGGESTIONS).toEqual([...RECITATION_SUGGESTIONS].sort((a, b) => a - b));
  });
});

describe("ADHKAR", () => {
  it("fit a notification tray", () => {
    for (const dhikr of ADHKAR) {
      const body = dhikrContent(dhikr).body;
      expect(body.length, body).toBeLessThanOrEqual(180);
      expect(dhikr.transliteration.trim()).toBe(dhikr.transliteration);
      expect(dhikr.meaning.endsWith("."), dhikr.meaning).toBe(true);
    }
  });

  it("offers something for every slot, and only what fits its moment", () => {
    for (const slot of SLOT_HOURS) {
      const picked = dhikrForSlot("2026-05-05", slot);
      expect(ADHKAR).toContain(picked);
    }
    // A dhikr for sleep never arrives mid-morning, and a morning one never
    // in the evening.
    const morning = new Set<string>();
    const evening = new Set<string>();
    for (let day = 1; day <= 28; day += 1) {
      const date = `2026-05-${String(day).padStart(2, "0")}`;
      morning.add(dhikrForSlot(date, 8).moment);
      evening.add(dhikrForSlot(date, 20).moment);
    }
    expect(morning.has("sleep")).toBe(false);
    expect(morning.has("evening")).toBe(false);
    expect(evening.has("morning")).toBe(false);
    expect(evening.has("waking")).toBe(false);
  });

  it("links a dhikr to the routine it belongs to, and the rest to the page", () => {
    const evening = ADHKAR.find((dhikr) => dhikr.moment === "evening")!;
    const salah = ADHKAR.find((dhikr) => dhikr.moment === "salah")!;
    const any = ADHKAR.find((dhikr) => dhikr.moment === "any")!;
    expect(dhikrContent(evening).url).toBe("/dhikr-duas#morning-evening");
    expect(dhikrContent(salah).url).toBe("/dhikr-duas#after-salah");
    expect(dhikrContent(any).url).toBe("/dhikr-duas");
    expect(dhikrContent(evening).title).toBe("An evening dhikr");
  });
});

describe("the remembrance slot", () => {
  it("takes turns: a dua, a dhikr, a Name", () => {
    expect(DUA_SLOT_KINDS).toEqual(["dua", "dhikr", "name"]);

    const kinds: string[] = [];
    for (let day = 1; day <= 3; day += 1) {
      for (const slot of ACTIVE_SLOTS) {
        kinds.push(duaSlotPick(`2026-05-0${day}`, slot).kind);
      }
    }
    // Twelve consecutive active slots: every kind four times, in rotation.
    expect(kinds.filter((k) => k === "dua")).toHaveLength(4);
    expect(kinds.filter((k) => k === "dhikr")).toHaveLength(4);
    expect(kinds.filter((k) => k === "name")).toHaveLength(4);
    for (let i = 1; i < kinds.length; i += 1) expect(kinds[i]).not.toBe(kinds[i - 1]);
  });

  it("is stable for a slot, so a re-run picks the same item", () => {
    expect(duaSlotPick("2026-05-05", 12)).toEqual(duaSlotPick("2026-05-05", 12));
  });

  it("reaches every Name and every dua in turn", () => {
    const names = new Set<number>();
    const duas = new Set<string>();
    // Enough active slots for the slowest rotation, the 99 Names, to lap.
    for (let day = 0; day < 99; day += 1) {
      const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
      for (const slot of ACTIVE_SLOTS) {
        const pick = duaSlotPick(date, slot);
        if (pick.kind === "name") names.add(pick.number);
        if (pick.kind === "dua") duas.add(keyOf(pick.ref));
      }
    }
    expect(names.size).toBe(99);
    expect(duas.size).toBe(QURANIC_DUAS.length);
  });

  it("never lands in a quiet slot", () => {
    // The pick is only asked for in active slots; the quiet ones send nothing.
    expect(QUIET_SLOTS.every((slot) => !ACTIVE_SLOTS.includes(slot))).toBe(true);
  });
});

describe("the game-mode reminder", () => {
  it("covers every mode and variant in the registry, once each", () => {
    const expected = GAME_MODES.flatMap((mode) =>
      mode.variants?.length ? mode.variants.map((v) => `${mode.id}/${v.id}`) : [mode.id],
    );
    expect(PLAY_SUGGESTIONS.map((s) => (s.variantId ? `${s.modeId}/${s.variantId}` : s.modeId)))
      .toEqual(expected);
    expect(PLAY_SUGGESTIONS.length).toBeGreaterThanOrEqual(5);
  });

  it("links to the game with the rules preselected", () => {
    const sequence = PLAY_SUGGESTIONS.find((s) => s.variantId === "sequence")!;
    const content = playContent(sequence);
    expect(content.url).toBe("/?mode=completion&variant=sequence");
    expect(content.title).toBe("Completion · Sequence");
    expect(content.body).toBe(sequence.tagline);

    const identify = PLAY_SUGGESTIONS.find((s) => s.modeId === "identify-surah")!;
    expect(playContent(identify).url).toBe("/?mode=identify-surah");
  });
});

describe("links", () => {
  it("open the reader at a Surah, and at an Ayah when there is one", () => {
    expect(readerUrl(2)).toBe("/learning-blocks?surah=2");
    expect(readerUrl(2, 152)).toBe("/learning-blocks?surah=2&ayah=152");
    expect(streakContent(3).url).toBe("/learning-blocks");
  });

  it("send the reconnect nudge back into the reader's own Surah", () => {
    const own = recitationContent("Al-Baqarah", 2);
    expect(own.title).toBe("Reconnect with");
    expect(own.body).toBe("Surah Al-Baqarah for a few minutes.");
    expect(own.url).toBe("/learning-blocks?surah=2");

    const suggested = recitationContent("Ar-Rahman", 55, true);
    expect(suggested.title).toBe("Time to listen");
    expect(suggested.body).toBe("Sit with Surah Ar-Rahman for a few minutes.");
  });

  it("open the Names page at the Name", () => {
    const content = nameContent({ number: 47, transliteration: "Al-Wadud", meaning: "The Loving One" });
    expect(content.url).toBe("/names-of-allah?name=47");
    expect(content.body).toBe("Al-Wadud — The Loving One");
  });

  it("only ever use slots the schedule knows", () => {
    const slots: SlotHour[] = [...SLOT_HOURS];
    for (const slot of slots) expect(() => dhikrForSlot("2026-05-05", slot)).not.toThrow();
  });
});
