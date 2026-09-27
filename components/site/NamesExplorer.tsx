"use client";

import { useEffect, useMemo, useState } from "react";
import { NAME_LANGUAGE_CODES } from "@/lib/content/name-language-codes";
import { prettyLanguage, REQUESTED_LANGUAGES } from "@/lib/quran/languages";

type NameItem = {
  number: number;
  arabic: string;
  transliteration: string;
  translation: string;
  meaning: string;
};

type NamesResponse = {
  names: NameItem[];
  requestedLanguage: string;
  language: string;
  translated: boolean;
  source?: string;
  notice?: string;
  error?: string;
};

const LANGUAGE_STORAGE_KEY = "surahspot:language";

function isSupportedNamesLanguage(language: string) {
  return language === "english" || Boolean(NAME_LANGUAGE_CODES[language as keyof typeof NAME_LANGUAGE_CODES]);
}

export function NamesExplorer() {
  const [language, setLanguage] = useState<string | null>(null);
  const [activeLanguage, setActiveLanguage] = useState("english");
  const [query, setQuery] = useState("");
  const [names, setNames] = useState<NameItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Reuse the same language preference as the Play experience. Unsupported
  // Names-provider languages fall back to English without changing the game's
  // preference.
  useEffect(() => {
    let stored = "english";
    try {
      stored = localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? "english";
    } catch {
      // localStorage can be unavailable in hardened/private browser modes.
    }

    setLanguage(
      REQUESTED_LANGUAGES.includes(stored as (typeof REQUESTED_LANGUAGES)[number]) &&
        isSupportedNamesLanguage(stored)
        ? stored
        : "english",
    );
  }, []);

  useEffect(() => {
    if (!language) return;

    const controller = new AbortController();
    let disposed = false;

    setLoading(true);
    setError("");
    setNotice("");

    fetch(`/api/content/names?language=${encodeURIComponent(language)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        const body = (await response.json()) as NamesResponse;
        if (!response.ok) throw new Error(body.error || "Could not load the Names.");
        if (!Array.isArray(body.names) || body.names.length !== 99) {
          throw new Error("The Names service returned incomplete content.");
        }
        return body;
      })
      .then((body) => {
        if (disposed) return;
        setNames(body.names);
        setActiveLanguage(body.language || "english");
        setNotice(body.notice ?? "");
      })
      .catch((caught) => {
        if (controller.signal.aborted || disposed) return;
        setError(caught instanceof Error ? caught.message : "Could not load the Names.");
      })
      .finally(() => {
        if (!controller.signal.aborted && !disposed) setLoading(false);
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [language]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return names;

    return names.filter((item) =>
      [item.arabic, item.transliteration, item.translation, item.meaning, String(item.number)].some(
        (value) => value.toLocaleLowerCase().includes(normalized),
      ),
    );
  }, [names, query]);

  function changeLanguage(nextLanguage: string) {
    if (!isSupportedNamesLanguage(nextLanguage)) return;

    setLanguage(nextLanguage);
    setQuery("");

    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    } catch {
      // Preference persistence is a convenience, not a requirement.
    }
  }

  return (
    <section className="names-explorer" aria-labelledby="names-explorer-title" aria-busy={loading}>
      <div className="resource-toolbar">
        <div>
          <p className="eyebrow">EXPLORE ALL 99</p>
          <h2 id="names-explorer-title">Search by name or meaning</h2>
          {language && !loading && !error ? (
            <p className="names-language-status" role="status">
              Showing meanings in <b>{prettyLanguage(activeLanguage)}</b>
            </p>
          ) : null}
        </div>

        <div className="resource-controls">
          <label className="resource-control">
            <span>Language</span>
            <select
              value={language ?? "english"}
              onChange={(event) => changeLanguage(event.target.value)}
              disabled={language === null}
              aria-label="99 Names translation language"
            >
              {REQUESTED_LANGUAGES.map((item) => {
                const supported = isSupportedNamesLanguage(item);
                return (
                  <option key={item} value={item} disabled={!supported}>
                    {prettyLanguage(item)}{supported ? "" : " — unavailable"}
                  </option>
                );
              })}
            </select>
          </label>

          <label className="resource-control resource-search">
            <span>Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Mercy, King, 17…"
              type="search"
            />
          </label>
        </div>
      </div>

      {notice && <p className="resource-notice" role="status">{notice}</p>}
      {error && <p className="resource-error" role="alert">{error}</p>}

      {loading && names.length === 0 ? (
        <div className="names-loading" aria-live="polite">Loading the Names…</div>
      ) : (
        <div className={`names-grid${loading ? " is-translating" : ""}`} aria-live="polite">
          {visible.map((item) => (
            <article className="name-card" key={item.number}>
              <span className="name-number">{String(item.number).padStart(2, "0")}</span>
              <p className="name-arabic" lang="ar" dir="rtl">{item.arabic}</p>
              <h3>{item.transliteration}</h3>
              <b dir="auto">{item.translation}</b>
              {item.meaning && item.meaning !== item.translation ? <p dir="auto">{item.meaning}</p> : null}
            </article>
          ))}

          {!visible.length && !loading ? <p className="resource-empty">No names match “{query}”.</p> : null}
        </div>
      )}
    </section>
  );
}
