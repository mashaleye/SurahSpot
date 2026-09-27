"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ShareSheet, type ShareSheetPayload } from "@/components/share/ShareSheet";
import { copyTextSafely } from "@/lib/share/client-actions";

type ShareBundle = {
  path: string;
  cardPath: string;
  title: string;
  textTemplate: string;
};

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V3m0 0L7.5 7.5M12 3l4.5 4.5M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" rx="3" />
      <path d="M16 8V7a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h1" />
    </svg>
  );
}

function resolveBundle(bundle: ShareBundle) {
  const shareUrl = new URL(bundle.path, window.location.origin).toString();
  return {
    shareUrl,
    shareText: bundle.textTemplate.replaceAll("{{SHARE_URL}}", shareUrl),
    cardUrl: new URL(bundle.cardPath, window.location.origin).toString(),
  };
}

export function ResultShareActions() {
  const cache = useRef<ShareBundle | null>(null);
  const [busy, setBusy] = useState<"share" | "copy" | null>(null);
  const [notice, setNotice] = useState("");
  const [sharePayload, setSharePayload] = useState<ShareSheetPayload | null>(null);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);

  const getBundle = useCallback(async () => {
    if (cache.current) return cache.current;
    const response = await fetch("/api/share/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not prepare this result for sharing.");
    cache.current = data as ShareBundle;
    return cache.current;
  }, []);

  useEffect(() => {
    void getBundle().catch(() => undefined);
  }, [getBundle]);

  const share = async () => {
    if (busy) return;
    setBusy("share");
    setNotice("");
    try {
      const bundle = await getBundle();
      const { shareUrl, shareText, cardUrl } = resolveBundle(bundle);
      setSharePayload({ title: bundle.title, text: shareText, url: shareUrl, cardUrl });
      setShareSheetOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not share this result.");
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (busy) return;
    setBusy("copy");
    setNotice("");
    try {
      const bundle = await getBundle();
      const { shareText } = resolveBundle(bundle);
      await copyTextSafely(shareText);
      setNotice("Result copied");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not copy this result.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="summary-share-block">
      <div className="summary-share-actions" aria-label="Share attempt result">
        <button type="button" className="share-result-button" onClick={share} disabled={Boolean(busy)}>
          <ShareIcon />
          {busy === "share" ? "Preparing…" : "Share result"}
        </button>
        <button type="button" className="copy-result-button" onClick={copy} disabled={Boolean(busy)}>
          <CopyIcon />
          {busy === "copy" ? "Copying…" : "Copy result"}
        </button>
      </div>
      <span className="share-result-notice" aria-live="polite">{notice}</span>
      <ShareSheet open={shareSheetOpen} payload={sharePayload} onClose={() => setShareSheetOpen(false)} />
    </div>
  );
}
