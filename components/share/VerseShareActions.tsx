"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ShareSheet, type ShareSheetPayload } from "@/components/share/ShareSheet";

function ShareIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m0 0L7.5 7.5M12 3l4.5 4.5M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" /></svg>;
}

type VerseShareBundle = {
  path: string;
  cardPath: string;
  title: string;
  textTemplate: string;
};

export function VerseShareActions({ token, language }: { token: string; language: string }) {
  const cache = useRef<{ key: string; bundle: VerseShareBundle } | null>(null);
  const bundleKey = `${token}:${language}`;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [sharePayload, setSharePayload] = useState<ShareSheetPayload | null>(null);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);

  const getBundle = useCallback(async () => {
    if (cache.current?.key === bundleKey) return cache.current.bundle;
    const response = await fetch("/api/share/verse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, language }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not prepare this Ayah for sharing.");
    const bundle = data as VerseShareBundle;
    cache.current = { key: bundleKey, bundle };
    return bundle;
  }, [bundleKey, language, token]);

  useEffect(() => {
    if (cache.current?.key !== bundleKey) cache.current = null;
    setShareSheetOpen(false);
    setSharePayload(null);
    void getBundle().catch(() => undefined);
  }, [bundleKey, getBundle]);

  const openShareSheet = async () => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const data = await getBundle();
      const url = new URL(data.path, window.location.origin).toString();
      const text = String(data.textTemplate).replaceAll("{{SHARE_URL}}", url);
      const cardUrl = new URL(data.cardPath, window.location.origin).toString();
      setSharePayload({ title: data.title, text, url, cardUrl });
      setShareSheetOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not share this Ayah.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="verse-share-action">
      <button type="button" className="verse-share-button" onClick={openShareSheet} disabled={busy}>
        <ShareIcon /> {busy ? "Preparing…" : "Share verse"}
      </button>
      <span aria-live="polite">{notice}</span>
      <ShareSheet open={shareSheetOpen} payload={sharePayload} onClose={() => setShareSheetOpen(false)} />
    </div>
  );
}
