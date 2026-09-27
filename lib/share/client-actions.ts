export type ShareActionPayload = {
  title?: string;
  text: string;
  url?: string;
};

export type ShareActionOutcome = "shared" | "copied" | "cancelled";
export type ShareCardOutcome = "shared" | "unsupported" | "cancelled";

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function getNavigator() {
  return typeof navigator === "undefined" ? null : navigator;
}

/**
 * Copy text without assuming the async Clipboard API exists.
 *
 * `navigator.clipboard` is secure-context gated and can be missing on iOS
 * Safari/WebKit when SurahSpot is opened from a LAN/Tailscale HTTP address.
 * The legacy selection + execCommand path is intentionally kept as a fallback
 * because it still covers those environments without crashing the UI.
 */
export async function copyTextSafely(text: string) {
  const nav = getNavigator();
  const clipboard = nav?.clipboard;
  const writeText = clipboard?.writeText;

  if (typeof writeText === "function") {
    try {
      await writeText.call(clipboard, text);
      return;
    } catch {
      // Permission/security-policy failures are allowed to fall through to the
      // selection fallback below. Do not expose browser exception text to UI.
    }
  }

  if (typeof document === "undefined" || !document.body) {
    throw new Error("Copying is not available in this browser.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.tabIndex = -1;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.padding = "0";
  textarea.style.border = "0";
  textarea.style.opacity = "0";
  textarea.style.fontSize = "16px";

  const activeElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const scrollX = typeof window !== "undefined" ? window.scrollX : 0;
  const scrollY = typeof window !== "undefined" ? window.scrollY : 0;

  document.body.appendChild(textarea);

  let copied = false;
  try {
    try {
      textarea.focus({ preventScroll: true });
    } catch {
      textarea.focus();
    }
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    copied = typeof document.execCommand === "function" && document.execCommand("copy");
  } finally {
    textarea.remove();

    if (activeElement && activeElement.isConnected) {
      try {
        activeElement.focus({ preventScroll: true });
      } catch {
        activeElement.focus();
      }
    }

    if (typeof window !== "undefined") {
      window.scrollTo(scrollX, scrollY);
    }
  }

  if (!copied) {
    throw new Error("Automatic copying is unavailable here. Try SurahSpot over HTTPS.");
  }
}

/** Fetch the existing Next.js Open Graph card as a PNG Blob. */
export async function fetchShareCardBlob(cardUrl: string) {
  const response = await fetch(cardUrl, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "image/png,image/*;q=0.9,*/*;q=0.5" },
  });
  if (!response.ok) throw new Error("Could not load the share card.");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("The share card response was not an image.");
  return blob;
}

/**
 * Copy a prepared card image when the browser exposes image clipboard support.
 * Returns false instead of throwing when that API simply does not exist so the
 * UI can fall back to copying the card URL.
 */
export async function copyImageBlobSafely(blob: Blob): Promise<boolean> {
  // Bind the clipboard itself rather than reaching through `nav` twice. The
  // optional chain narrows `clipboard`, which is what `write` is invoked
  // against, so the call no longer depends on `nav` being non-null.
  const clipboard = getNavigator()?.clipboard;
  const write = clipboard?.write;
  if (!clipboard || typeof write !== "function" || typeof ClipboardItem === "undefined") return false;

  try {
    const type = blob.type || "image/png";
    await write.call(clipboard, [new ClipboardItem({ [type]: blob })]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Instagram does not provide a standard browser share-intent URL. On mobile,
 * the most reliable standards-based bridge is the OS share sheet with the
 * SurahSpot card attached as a file; Instagram appears there when installed.
 */
export async function shareCardFileSafely(input: ShareActionPayload & {
  blob: Blob;
  fileName: string;
}): Promise<ShareCardOutcome> {
  const nav = getNavigator();
  if (!nav || typeof nav.share !== "function" || typeof File === "undefined") return "unsupported";

  const file = new File([input.blob], input.fileName, {
    type: input.blob.type || "image/png",
    lastModified: Date.now(),
  });

  const files = [file];
  if (typeof nav.canShare === "function") {
    try {
      if (!nav.canShare({ files })) return "unsupported";
    } catch {
      return "unsupported";
    }
  }

  try {
    await nav.share({
      title: input.title,
      text: input.text,
      url: input.url,
      files,
    });
    return "shared";
  } catch (error) {
    if (isAbortError(error)) return "cancelled";
    return "unsupported";
  }
}

/**
 * Retained as a generic capability-safe helper for any non-custom-sheet share
 * flow. The SurahSpot verse/result buttons now open the custom ShareSheet.
 */
export async function shareOrCopySafely(payload: ShareActionPayload): Promise<ShareActionOutcome> {
  const nav = getNavigator();

  if (nav && typeof nav.share === "function") {
    try {
      await nav.share({
        title: payload.title,
        text: payload.text,
        url: payload.url,
      });
      return "shared";
    } catch (error) {
      if (isAbortError(error)) return "cancelled";
    }
  }

  await copyTextSafely(payload.text);
  return "copied";
}
