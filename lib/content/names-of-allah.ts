import "server-only";
import { namesContentConfig } from "@/lib/config/env";
import { nameLanguageCode } from "./name-language-codes";

export type NameOfAllah = {
  number: number;
  arabic: string;
  transliteration: string;
  translation: string;
  meaning: string;
};

export type NamesResult = {
  names: NameOfAllah[];
  requestedLanguage: string;
  language: string;
  translated: boolean;
  source: "aladhan" | "islamicapi";
  notice?: string;
};

type AladhanItem = {
  number?: number;
  name?: string;
  transliteration?: string;
  en?: { meaning?: string };
};

type IslamicApiItem = {
  number?: number;
  name?: string;
  transliteration?: string;
  translation?: string;
  meaning?: string;
};

type IslamicApiPayload = {
  code?: number;
  status?: string;
  data?: {
    names?: IslamicApiItem[];
    language?: string;
    language_code?: string;
  };
  message?: string;
};

const ENGLISH_ENDPOINT = "https://api.aladhan.com/v1/asmaAlHusna";
const TRANSLATED_ENDPOINT = "https://islamicapi.com/api/v1/asma-ul-husna/";
const UPSTREAM_TIMEOUT_MS = 12_000;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validNumber(value: unknown, index: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 99 ? parsed : index + 1;
}

function ensureComplete(names: NameOfAllah[]) {
  const byNumber = new Map<number, NameOfAllah>();

  for (const name of names) {
    if (!name.arabic || !name.transliteration || !name.translation) continue;
    if (name.number < 1 || name.number > 99) continue;
    byNumber.set(name.number, name);
  }

  const complete = Array.from(byNumber.values()).sort((a, b) => a.number - b.number);
  if (complete.length !== 99) {
    throw new Error(`Names provider returned ${complete.length} of 99 complete names.`);
  }

  return complete;
}

async function fetchEnglish(): Promise<NameOfAllah[]> {
  const response = await fetch(ENGLISH_ENDPOINT, {
    next: { revalidate: 86_400 },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });

  if (!response.ok) throw new Error(`English names provider returned ${response.status}.`);

  const payload = (await response.json()) as { data?: AladhanItem[] };

  return ensureComplete(
    (payload.data ?? []).map((item, index) => {
      const meaning = clean(item.en?.meaning);
      return {
        number: validNumber(item.number, index),
        arabic: clean(item.name),
        transliteration: clean(item.transliteration),
        translation: meaning,
        meaning,
      };
    }),
  );
}

async function fetchTranslated(languageCode: string, apiKey: string): Promise<NameOfAllah[]> {
  const url = new URL(TRANSLATED_ENDPOINT);
  url.searchParams.set("language", languageCode);
  url.searchParams.set("api_key", apiKey);

  const response = await fetch(url, {
    next: { revalidate: 86_400 },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Translated names provider returned ${response.status}.`);
  }

  const payload = (await response.json()) as IslamicApiPayload;
  if (payload.status && payload.status !== "success") {
    throw new Error(clean(payload.message) || "Translated names provider rejected the request.");
  }

  return ensureComplete(
    (payload.data?.names ?? []).map((item, index) => {
      const translation = clean(item.translation);
      return {
        number: validNumber(item.number, index),
        arabic: clean(item.name),
        transliteration: clean(item.transliteration),
        translation,
        meaning: clean(item.meaning) || translation,
      };
    }),
  );
}

export async function getNamesOfAllah(requestedLanguage: string): Promise<NamesResult> {
  if (requestedLanguage === "english") {
    return {
      names: await fetchEnglish(),
      requestedLanguage,
      language: "english",
      translated: true,
      source: "aladhan",
    };
  }

  const languageCode = nameLanguageCode(requestedLanguage);
  if (!languageCode) {
    return {
      names: await fetchEnglish(),
      requestedLanguage,
      language: "english",
      translated: false,
      source: "aladhan",
      notice: `${requestedLanguage} is not currently available from the 99 Names translation provider. Showing English instead.`,
    };
  }

  const { islamicApiKey } = namesContentConfig();
  if (!islamicApiKey) {
    return {
      names: await fetchEnglish(),
      requestedLanguage,
      language: "english",
      translated: false,
      source: "aladhan",
      notice:
        "99 Names translations need the server-side ISLAMIC_API_KEY. Add the free IslamicAPI key to .env.local, restart SurahSpot, and this language will load automatically.",
    };
  }

  try {
    return {
      names: await fetchTranslated(languageCode, islamicApiKey),
      requestedLanguage,
      language: requestedLanguage,
      translated: true,
      source: "islamicapi",
    };
  } catch (error) {
    console.warn("[names-of-allah] translated provider unavailable; falling back to English", {
      requestedLanguage,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      names: await fetchEnglish(),
      requestedLanguage,
      language: "english",
      translated: false,
      source: "aladhan",
      notice: `Could not load ${requestedLanguage} right now. Showing English instead.`,
    };
  }
}
