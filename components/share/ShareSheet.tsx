"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { BrandMark } from "@/components/share/BrandMarks";
import {
  copyImageBlobSafely,
  copyTextSafely,
  fetchShareCardBlob,
  shareCardFileSafely,
} from "@/lib/share/client-actions";

export type ShareSheetPayload = {
  title: string;
  text: string;
  url: string;
  cardUrl: string;
};

type ShareSheetProps = {
  open: boolean;
  payload: ShareSheetPayload | null;
  onClose: () => void;
};

type SocialTarget = "facebook" | "x" | "whatsapp";

type ActionIconProps = {
  kind: "facebook" | "x" | "whatsapp" | "instagram" | "embed" | "card";
};

function ActionIcon({ kind }: ActionIconProps) {
  if (kind === "facebook" || kind === "x" || kind === "whatsapp" || kind === "instagram") {
    return <BrandMark name={kind} />;
  }

  if (kind === "embed") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="m12.2 9-7 7 7 7M19.8 9l7 7-7 7" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="6" y="6" width="20" height="20" rx="2.8" />
      <circle cx="12" cy="12" r="2" className="share-icon-fill" />
      <path d="m8.5 23 6.3-6.7 4.1 4 2.5-2.5 2.1 2.2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function makeSocialUrl(target: SocialTarget, payload: ShareSheetPayload) {
  const encodedUrl = encodeURIComponent(payload.url);
  const textWithoutUrl = payload.text.replaceAll(payload.url, "").trim();

  if (target === "facebook") {
    return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
  }

  if (target === "x") {
    const message = [textWithoutUrl, payload.url].filter(Boolean).join("\n\n");
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`;
  }

  return `https://wa.me/?text=${encodeURIComponent(payload.text)}`;
}

function buildEmbedCode(payload: ShareSheetPayload) {
  const safeTitle = payload.title.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<iframe src="${payload.url}" title="${safeTitle}" width="600" height="420" loading="lazy" style="width:100%;max-width:600px;border:0;border-radius:20px;overflow:hidden" allow="clipboard-write"></iframe>`;
}

function openExternal(url: string) {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) opened.opener = null;
}

export function ShareSheet({ open, payload, onClose }: ShareSheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const cardBlobRef = useRef<{ url: string; blob: Blob } | null>(null);
  const [notice, setNotice] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"loading" | "ready" | "error">("loading");

  const displayUrl = useMemo(() => payload?.url.replace(/^https?:\/\//, "") ?? "", [payload?.url]);

  useEffect(() => {
    if (!open || !payload) return;

    setNotice("");
    setBusyAction(null);
    setPreviewSrc(null);
    setPreviewStatus("loading");
    const previousOverflow = document.documentElement.style.overflow;
    const previousBodyPadding = document.body.style.paddingRight;
    const scrollbarGap = Math.max(0, window.innerWidth - document.documentElement.clientWidth);

    document.documentElement.style.overflow = "hidden";
    if (scrollbarGap > 0) document.body.style.paddingRight = `${scrollbarGap}px`;

    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus({ preventScroll: true }), 30);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    let active = true;
    let objectUrl: string | null = null;
    void fetchShareCardBlob(payload.cardUrl)
      .then((blob) => {
        if (!active) return;
        cardBlobRef.current = { url: payload.cardUrl, blob };
        objectUrl = URL.createObjectURL(blob);
        setPreviewSrc(objectUrl);
        setPreviewStatus("ready");
      })
      .catch(() => {
        if (active) setPreviewStatus("error");
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      document.documentElement.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousBodyPadding;
    };
  }, [onClose, open, payload]);

  if (!open || !payload || typeof document === "undefined") return null;

  const getCardBlob = async () => {
    if (cardBlobRef.current?.url === payload.cardUrl) return cardBlobRef.current.blob;
    const blob = await fetchShareCardBlob(payload.cardUrl);
    cardBlobRef.current = { url: payload.cardUrl, blob };
    return blob;
  };

  const copyLink = async () => {
    if (busyAction) return;
    setBusyAction("link");
    setNotice("");
    try {
      await copyTextSafely(payload.url);
      setNotice("Link copied");
    } catch {
      setNotice("Could not copy the link in this browser.");
    } finally {
      setBusyAction(null);
    }
  };

  const copyEmbed = async () => {
    if (busyAction) return;
    setBusyAction("embed");
    setNotice("");
    try {
      await copyTextSafely(buildEmbedCode(payload));
      setNotice("Embed code copied");
    } catch {
      setNotice("Could not copy the embed code in this browser.");
    } finally {
      setBusyAction(null);
    }
  };

  const copyCard = async () => {
    if (busyAction) return;
    setBusyAction("card");
    setNotice("");
    try {
      const blob = await getCardBlob();
      const copied = await copyImageBlobSafely(blob);
      if (copied) {
        setNotice("Card copied");
      } else {
        await copyTextSafely(payload.cardUrl);
        setNotice("Image clipboard is unavailable here — card link copied instead.");
      }
    } catch {
      try {
        await copyTextSafely(payload.cardUrl);
        setNotice("Could not copy the image — card link copied instead.");
      } catch {
        setNotice("Could not copy this card in this browser.");
      }
    } finally {
      setBusyAction(null);
    }
  };

  const shareSocial = (target: SocialTarget) => {
    if (busyAction) return;
    openExternal(makeSocialUrl(target, payload));
  };

  const shareInstagram = async () => {
    if (busyAction) return;
    setBusyAction("instagram");
    setNotice("Preparing the card for Instagram…");
    try {
      const blob = await getCardBlob();
      const outcome = await shareCardFileSafely({
        title: payload.title,
        text: payload.text,
        url: payload.url,
        blob,
        fileName: "surahspot-card.png",
      });

      if (outcome === "shared") {
        setNotice("Shared");
      } else if (outcome === "cancelled") {
        setNotice("");
      } else {
        await copyTextSafely(payload.url);
        openExternal("https://www.instagram.com/");
        setNotice("Link copied — paste it into Instagram.");
      }
    } catch {
      try {
        await copyTextSafely(payload.url);
        openExternal("https://www.instagram.com/");
        setNotice("Link copied — paste it into Instagram.");
      } catch {
        setNotice("Instagram sharing is unavailable in this browser.");
      }
    } finally {
      setBusyAction(null);
    }
  };

  return createPortal(
    <div className="custom-share-sheet-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="custom-share-sheet" role="dialog" aria-modal="true" aria-labelledby="custom-share-sheet-title">
        <div className="custom-share-sheet-handle" aria-hidden="true" />

        <header className="custom-share-sheet-header">
          <div>
            <p>SHARE</p>
            <h2 id="custom-share-sheet-title">{payload.title}</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="custom-share-sheet-close" onClick={onClose} aria-label="Close share sheet">
            <CloseIcon />
          </button>
        </header>

        <div
          className={`custom-share-sheet-card-preview is-${previewStatus}`}
          aria-label="Share card preview"
          aria-busy={previewStatus === "loading"}
        >
          {previewSrc && previewStatus !== "error" ? (
            <img
              src={previewSrc}
              alt=""
              draggable={false}
              onError={() => setPreviewStatus("error")}
            />
          ) : null}
          {previewStatus === "loading" ? (
            <div className="custom-share-sheet-card-loading" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ) : null}
          {previewStatus === "error" ? (
            <div className="custom-share-sheet-card-fallback">
              <span className="custom-share-sheet-card-fallback-mark" aria-hidden="true">SS</span>
              <strong>{payload.title}</strong>
              <span>Card preview unavailable</span>
            </div>
          ) : null}
        </div>

        <div className="custom-share-sheet-link-row">
          <div className="custom-share-sheet-link" title={payload.url}>{displayUrl}</div>
          <button type="button" onClick={copyLink} disabled={Boolean(busyAction)}>
            {busyAction === "link" ? "Copying…" : "Copy Link"}
          </button>
        </div>

        <div className="custom-share-sheet-grid" aria-label="Share options">
          <button type="button" className="custom-share-sheet-option" onClick={() => shareSocial("facebook")}>
            <span className="custom-share-sheet-icon"><ActionIcon kind="facebook" /></span>
            <span>Facebook</span>
          </button>

          <button type="button" className="custom-share-sheet-option" onClick={() => shareSocial("x")}>
            <span className="custom-share-sheet-icon"><ActionIcon kind="x" /></span>
            <span>X</span>
          </button>

          <button type="button" className="custom-share-sheet-option" onClick={() => shareSocial("whatsapp")}>
            <span className="custom-share-sheet-icon"><ActionIcon kind="whatsapp" /></span>
            <span>WhatsApp</span>
          </button>

          <button type="button" className="custom-share-sheet-option" onClick={shareInstagram} disabled={Boolean(busyAction)}>
            <span className="custom-share-sheet-icon custom-share-sheet-icon-instagram"><ActionIcon kind="instagram" /></span>
            <span>Instagram</span>
          </button>

          <button type="button" className="custom-share-sheet-option" onClick={copyEmbed} disabled={Boolean(busyAction)}>
            <span className="custom-share-sheet-icon"><ActionIcon kind="embed" /></span>
            <span>Copy Embed</span>
          </button>

          <button type="button" className="custom-share-sheet-option" onClick={copyCard} disabled={Boolean(busyAction)}>
            <span className="custom-share-sheet-icon custom-share-sheet-icon-card"><ActionIcon kind="card" /></span>
            <span>{busyAction === "card" ? "Copying…" : "Copy Card"}</span>
          </button>
        </div>

        <div className="custom-share-sheet-notice" aria-live="polite">{notice}</div>
      </section>
    </div>,
    document.body,
  );
}
