import { REQUESTED_LANGUAGES } from "@/lib/quran/languages";

/**
 * Project language id -> IslamicAPI Asma-ul-Husna language code.
 *
 * The page always uses the same project language ids as the game. Languages
 * the provider does not currently offer stay visible but disabled rather than
 * silently falling back to a different language.
 */
export const NAME_LANGUAGE_CODES: Partial<Record<(typeof REQUESTED_LANGUAGES)[number], string>> = {
  english: "en",
  albanian: "sq",
  amharic: "am",
  arabic: "ar",
  azeri: "az",
  bengali: "bn",
  bosnian: "bs",
  bulgarian: "bg",
  "central khmer": "km",
  chinese: "zh",
  croatian: "hr",
  czech: "cs",
  divehi: "dv",
  dutch: "nl",
  filipino: "tl",
  finnish: "fi",
  french: "fr",
  german: "de",
  gujarati: "gu",
  hausa: "ha",
  hebrew: "he",
  hindi: "hi",
  indonesian: "id",
  italian: "it",
  japanese: "ja",
  kannada: "kn",
  kazakh: "kk",
  khmer: "km",
  korean: "ko",
  kurdish: "ku",
  lithuanian: "lt",
  malay: "ms",
  malayalam: "ml",
  marathi: "mr",
  nepali: "ne",
  norwegian: "no",
  pashto: "ps",
  persian: "fa",
  polish: "pl",
  portuguese: "pt",
  punjabi: "pa",
  romanian: "ro",
  russian: "ru",
  serbian: "sr",
  sindhi: "sd",
  "sinhala, sinhalese": "si",
  somali: "so",
  spanish: "es",
  swahili: "sw",
  swedish: "sv",
  tagalog: "tl",
  tamil: "ta",
  telugu: "te",
  thai: "th",
  turkish: "tr",
  "uighur, uyghur": "ug",
  ukrainian: "uk",
  urdu: "ur",
  uzbek: "uz",
  vietnamese: "vi",
};

export function nameLanguageCode(language: string) {
  return NAME_LANGUAGE_CODES[language as keyof typeof NAME_LANGUAGE_CODES] ?? null;
}
