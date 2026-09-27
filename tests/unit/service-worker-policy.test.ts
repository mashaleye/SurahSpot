import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * These assertions run against public/sw.js itself.
 *
 * The caching rules are correctness-sensitive — one of them is the only thing
 * standing between a cache and the endpoint that carries round answers — so
 * the test loads the shipped file and calls its real classifier rather than a
 * copy that could drift from it.
 */

type Classifier = (request: { method: string; url: string; mode?: string; headers: Headers }) => string;

let classifyRequest: Classifier;

function request(url: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}) {
  return {
    method: init.method ?? "GET",
    url,
    mode: init.mode ?? "cors",
    headers: new Headers(init.headers ?? {}),
  };
}

beforeAll(() => {
  const source = readFileSync("public/sw.js", "utf8");

  // A minimal worker global: enough for the file to evaluate and register its
  // listeners, without pretending to be a real ServiceWorkerGlobalScope.
  const listeners: Record<string, unknown> = {};
  const self: Record<string, unknown> = {
    location: { origin: "https://surahspot.app" },
    addEventListener: (type: string, handler: unknown) => { listeners[type] = handler; },
    registration: { showNotification: () => {} },
    clients: { matchAll: async () => [], openWindow: async () => {}, claim: async () => {} },
    skipWaiting: () => {},
  };

  const context = createContext({
    self,
    caches: { open: async () => ({}), keys: async () => [], match: async () => undefined, delete: async () => true },
    fetch: async () => new Response(""),
    Response,
    Headers,
    URL,
    console,
  });

  runInContext(source, context);
  classifyRequest = (self.__swPolicy as { classifyRequest: Classifier }).classifyRequest;
});

const origin = "https://surahspot.app";

describe("service worker request policy", () => {
  it("never caches the endpoint that carries round answers", () => {
    // The single most important rule here: a cached round is a leaked answer.
    expect(classifyRequest(request(`${origin}/api/quran/round?mode=identify-surah`))).toBe("bypass");
  });

  it("never caches audio, which is served as range requests", () => {
    expect(classifyRequest(request(`${origin}/api/quran/audio?token=abc`))).toBe("bypass");
  });

  it("never caches per-request or stateful endpoints", () => {
    for (const path of [
      "/api/quran/search?q=fatihah",
      "/api/quran/translate",
      "/api/quran/config",
      "/api/game/attempt",
      "/api/health",
      "/api/share/verse",
      "/api/notifications/subscribe",
    ]) {
      expect(classifyRequest(request(origin + path))).toBe("bypass");
    }
  });

  it("caches Qur'an reading content", () => {
    expect(classifyRequest(request(`${origin}/api/quran/learning/surah?chapter=2&language=english`))).toBe("quran");
    expect(classifyRequest(request(`${origin}/api/quran/learning/config`))).toBe("quran");
    expect(classifyRequest(request(`${origin}/api/quran/learning/block?chapter=2`))).toBe("quran");
  });

  it("does not confuse the learning config with the game config", () => {
    expect(classifyRequest(request(`${origin}/api/quran/config`))).toBe("bypass");
    expect(classifyRequest(request(`${origin}/api/quran/learning/config`))).toBe("quran");
  });

  it("caches immutable build output and vendored assets", () => {
    for (const path of [
      "/_next/static/chunks/main-abc123.js",
      "/fonts/UthmanicHafs1Ver18.ttf",
      "/brand/surahspot-mark.svg",
      "/images/hero.png",
      "/pwa/splash/iphone-390x844@3x.png",
      "/icon-192.png",
      "/apple-touch-icon.png",
      "/manifest.webmanifest",
    ]) {
      expect(classifyRequest(request(origin + path))).toBe("static");
    }
  });

  it("handles page navigations so they work offline", () => {
    expect(classifyRequest(request(`${origin}/learning-blocks`, { mode: "navigate" }))).toBe("navigate");
  });

  it("leaves React Server Component payloads to the network", () => {
    // They vary on headers this worker does not key on, so a cached copy
    // could be served for the wrong route.
    expect(classifyRequest(request(`${origin}/learning-blocks?_rsc=1a2b3c`, { mode: "navigate" }))).toBe("bypass");
    expect(classifyRequest(request(`${origin}/learning-blocks`, { mode: "navigate", headers: { RSC: "1" } }))).toBe("bypass");
  });

  it("only handles GET", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(classifyRequest(request(`${origin}/api/quran/learning/surah?chapter=2`, { method }))).toBe("bypass");
    }
  });

  it("ignores other origins", () => {
    expect(classifyRequest(request("https://example.com/_next/static/chunks/main.js"))).toBe("bypass");
    expect(classifyRequest(request("https://cdn.example.com/audio.mp3"))).toBe("bypass");
  });

  it("ignores requests it cannot parse", () => {
    expect(classifyRequest(request("not-a-url"))).toBe("bypass");
  });
});
