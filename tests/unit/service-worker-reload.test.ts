import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The first visit must not reload itself.
 *
 * sw.js calls clients.claim() on activate, so on a reader's very first visit
 * the controller goes from null to the new worker while the page is already
 * loaded and working. ServiceWorkerBridge listens for `controllerchange` in
 * order to finish a reader-requested update — and for a while it did not
 * distinguish the two, so every first-time visitor loaded the whole page
 * twice: 2.1s of wasted time on a throttled mobile connection, every script
 * evaluated again, and the largest single item in a mobile Lighthouse run.
 *
 * It was invisible in ordinary testing, because the second visit already has a
 * controller and the bug cannot fire. That is what makes it worth a test, and
 * it is why these assertions are about the SOURCE rather than about behaviour:
 * reproducing it needs a real worker completing a real activation, which jsdom
 * does not have. The structural guarantees below are the ones that broke.
 */

const BRIDGE = readFileSync("components/pwa/ServiceWorkerBridge.tsx", "utf8");
const WORKER = readFileSync("public/sw.js", "utf8");

/** The body of `onControllerChange`, up to its closing brace. */
function controllerChangeHandler(): string {
  const start = BRIDGE.indexOf("const onControllerChange");
  expect(start, "onControllerChange should exist").toBeGreaterThan(-1);

  const body = BRIDGE.slice(start);
  const end = body.indexOf("\n    };");
  expect(end, "onControllerChange should be terminated").toBeGreaterThan(-1);
  return body.slice(0, end);
}

describe("the condition that made the bug possible", () => {
  it("still has a worker that claims clients on activate", () => {
    // If this ever stops being true the reload guard is no longer load-bearing
    // — but so is the immediate offline support, so the test should be revisited
    // rather than deleted.
    expect(WORKER).toMatch(/clients\.claim\(\)/);
  });

  it("still only skips waiting when the page asks it to", () => {
    // The guard assumes the ONLY route to a deliberate controller change is the
    // reader tapping Refresh. A worker that called skipWaiting() on its own —
    // in install, or unconditionally in activate — would break that assumption
    // and strand readers on a stale page with no reload.
    expect(WORKER).toMatch(/SKIP_WAITING["']?\s*\)?\s*\)?\s*self\.skipWaiting\(\)/);

    const install = WORKER.slice(WORKER.indexOf('addEventListener("install"'), WORKER.indexOf('addEventListener("activate"'));
    expect(install).not.toMatch(/skipWaiting/);
  });
});

describe("ServiceWorkerBridge reload gating", () => {
  it("reloads only when an update was requested", () => {
    const handler = controllerChangeHandler();

    // An early return on the flag, before any reload.
    expect(handler).toMatch(/if\s*\(\s*!updateRequestedRef\.current\s*\)\s*return\s*;/);

    const guardAt = handler.indexOf("!updateRequestedRef.current");
    const reloadAt = handler.indexOf("location.reload");
    expect(reloadAt, "the handler should still reload").toBeGreaterThan(-1);
    expect(guardAt, "the guard must come before the reload").toBeLessThan(reloadAt);
  });

  it("keeps the separate guard against a reload loop", () => {
    // Chrome can fire controllerchange more than once. Losing this guard turns
    // an update into an unrecoverable reload loop, which is worse than the bug
    // this file exists for.
    const handler = controllerChangeHandler();
    expect(handler).toMatch(/if\s*\(\s*reloadingRef\.current\s*\)\s*return\s*;/);
    expect(handler).toMatch(/reloadingRef\.current\s*=\s*true/);
  });

  it("raises the flag before telling the worker to take over", () => {
    /*
     * Ordering matters: the worker can activate and fire controllerchange
     * before postMessage returns. Setting the flag afterwards would lose the
     * race and leave the reader looking at a page running against a worker it
     * was not loaded with — the update silently not applying.
     */
     const start = BRIDGE.indexOf("const applyUpdate");
    expect(start).toBeGreaterThan(-1);
    const body = BRIDGE.slice(start, BRIDGE.indexOf("}, []);", start));

    const flagAt = body.indexOf("updateRequestedRef.current = true");
    // The call itself, not the bare word: the comment above it names
    // postMessage too, and matching that compared the comment's position
    // rather than the code's.
    const postAt = body.search(/postMessage\(\{\s*type:\s*"SKIP_WAITING"\s*\}\)/);
    expect(flagAt, "applyUpdate should set the flag").toBeGreaterThan(-1);
    expect(postAt, "applyUpdate should post SKIP_WAITING").toBeGreaterThan(-1);
    expect(flagAt).toBeLessThan(postAt);
  });

  it("still guards the update prompt on the existing controller", () => {
    // The other half of the same distinction: "installed" means "works offline
    // now" on a first visit, and "a newer version exists" only when something
    // was already controlling the page.
    expect(BRIDGE).toMatch(/installing\.state === "installed" && navigator\.serviceWorker\.controller/);
  });
});
