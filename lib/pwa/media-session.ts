"use client";

/**
 * Lock-screen and hardware media controls.
 *
 * On a phone this is most of the difference between a web page that happens
 * to play audio and something that behaves like an app: the recitation shows
 * up on the lock screen, headphone and car-stereo buttons work, and the OS
 * knows what is playing when it decides who keeps audio focus after a call.
 *
 * One rule governs everything here: **the metadata must never name the Surah
 * while it is the answer.** The lock screen is outside the app's control and
 * outside its reveal logic, so a title assembled from the round would hand
 * the player the answer from the notification shade. The caller says
 * explicitly when a name is safe to show.
 */

import { useEffect } from "react";

type MediaSessionLike = {
  metadata: unknown;
  playbackState: "none" | "paused" | "playing";
  setActionHandler: (action: string, handler: ((details: unknown) => void) | null) => void;
  setPositionState?: (state: { duration: number; playbackRate: number; position: number }) => void;
};

function session(): MediaSessionLike | null {
  if (typeof navigator === "undefined") return null;
  const candidate = (navigator as { mediaSession?: MediaSessionLike }).mediaSession;
  return candidate ?? null;
}

/** Actions a browser may not know; setting an unknown one throws. */
function setHandler(
  target: MediaSessionLike,
  action: string,
  handler: ((details: unknown) => void) | null,
) {
  try {
    target.setActionHandler(action, handler);
  } catch {
    // Unsupported action. Nothing to do: the OS simply will not offer it.
  }
}

export type MediaSessionOptions = {
  /** Whether there is anything to control at all. */
  active: boolean;
  playing: boolean;

  /**
   * What to show. Pass a neutral title while the Surah is still the answer —
   * this module will not decide that for you.
   */
  title: string;
  artist?: string;

  /** Seconds. Used for the scrubber the OS draws. */
  duration?: number;
  position?: number;
  playbackRate?: number;

  onPlay: () => void;
  onPause: () => void;
  /** Absolute seek, in seconds. Omit to leave the OS scrubber inert. */
  onSeek?: (seconds: number) => void;
  onStop?: () => void;
};

export function useMediaSession(options: MediaSessionOptions) {
  const {
    active, playing, title, artist,
    duration, position, playbackRate,
    onPlay, onPause, onSeek, onStop,
  } = options;

  /* Metadata and playback state: cheap, and changes with the round. */
  useEffect(() => {
    const target = session();
    if (!target) return;

    if (!active) {
      target.metadata = null;
      target.playbackState = "none";
      return;
    }

    const MediaMetadataCtor = (window as unknown as {
      MediaMetadata?: new (init: Record<string, unknown>) => unknown;
    }).MediaMetadata;

    if (MediaMetadataCtor) {
      target.metadata = new MediaMetadataCtor({
        title,
        artist: artist || "SurahSpot",
        album: "SurahSpot",
        artwork: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      });
    }

    target.playbackState = playing ? "playing" : "paused";
  }, [active, artist, playing, title]);

  /* Action handlers, rebound when the callbacks change. */
  useEffect(() => {
    const target = session();
    if (!target) return;

    if (!active) {
      for (const action of ["play", "pause", "stop", "seekto", "seekforward", "seekbackward"]) {
        setHandler(target, action, null);
      }
      return;
    }

    setHandler(target, "play", () => onPlay());
    setHandler(target, "pause", () => onPause());
    setHandler(target, "stop", onStop ? () => onStop() : null);

    if (onSeek) {
      setHandler(target, "seekto", (details) => {
        const seekTime = (details as { seekTime?: number } | undefined)?.seekTime;
        if (typeof seekTime === "number") onSeek(seekTime);
      });

      // Ten seconds is the platform default and what the OS draws on its
      // skip buttons, so matching it keeps the labels honest.
      setHandler(target, "seekbackward", () => {
        if (typeof position === "number") onSeek(Math.max(0, position - 10));
      });
      setHandler(target, "seekforward", () => {
        if (typeof position === "number" && typeof duration === "number") {
          onSeek(Math.min(duration, position + 10));
        }
      });
    }

    return () => {
      for (const action of ["play", "pause", "stop", "seekto", "seekforward", "seekbackward"]) {
        setHandler(target, action, null);
      }
    };
  }, [active, duration, onPause, onPlay, onSeek, onStop, position]);

  /*
   * Position state, for the OS scrubber.
   *
   * Reported only on meaningful change rather than every frame: this crosses
   * into the browser's media process, and calling it from an animation frame
   * is a measurable cost for a control most players glance at once.
   */
  useEffect(() => {
    const target = session();
    if (!target?.setPositionState || !active) return;
    if (typeof duration !== "number" || typeof position !== "number") return;
    if (!Number.isFinite(duration) || duration <= 0) return;

    try {
      target.setPositionState({
        duration,
        playbackRate: playbackRate && playbackRate > 0 ? playbackRate : 1,
        // A position past the duration throws rather than clamping.
        position: Math.min(Math.max(0, position), duration),
      });
    } catch {
      // Some browsers reject mid-seek states. The next update corrects it.
    }
  }, [active, duration, playbackRate, position]);
}
