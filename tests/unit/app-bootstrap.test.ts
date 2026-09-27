import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guards the pre-paint bootstrap script in app/layout.tsx.
 *
 * That script runs in plain DOM before React hydrates, which is the whole
 * point of it — but it shares <body> with React-rendered markup, and the two
 * have to agree about who owns which node.
 *
 * It got this wrong once, in a way worth pinning down: finish() removed the
 * splash element from the DOM. The splash is rendered by AppSplash, a server
 * component inside <body>, so React's tree still described a child that was
 * no longer there. The next time it reconciled <body> — every client-side
 * navigation — insertBefore threw NotFoundError and the app died with
 * "Application error: a client-side exception has occurred".
 *
 * It only ever surfaced in the installed home-screen app, because that is the
 * only place the splash branch runs. Nothing in development, in CI, or in an
 * ordinary browser tab would have caught it, which is why it is asserted here
 * rather than left to a browser test.
 */

const layout = readFileSync("app/layout.tsx", "utf8");

/**
 * The bootstrap script, which is a template literal in that file, with its
 * comments stripped.
 *
 * Stripping matters: the comment explaining this very bug names the DOM calls
 * it warns against, and a plain text search would match the warning and fail.
 * What is being asserted is what the script *does*.
 */
function bootstrapSource() {
  const start = layout.indexOf("const APP_BOOTSTRAP = `");
  expect(start).toBeGreaterThan(-1);
  const from = layout.indexOf("`", start) + 1;
  const to = layout.indexOf("`;", from);
  expect(to).toBeGreaterThan(from);

  return layout
    .slice(from, to)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("pre-paint bootstrap", () => {
  const script = bootstrapSource();

  it("never removes a node React rendered", () => {
    // The splash is hidden with an attribute and CSS instead.
    expect(script).not.toMatch(/removeChild/);
    expect(script).not.toMatch(/\.remove\(\s*\)/);
  });

  it("does not insert nodes into the React-owned body either", () => {
    // The mirror of the same mistake: a node React does not know about,
    // sitting among children it is about to reconcile.
    expect(script).not.toMatch(/document\.body\.appendChild/);
    expect(script).not.toMatch(/insertBefore/);
  });

  it("still dismisses the splash by setting the attribute", () => {
    // Which is what globals.css keys the display rule off.
    expect(script).toMatch(/dataset\.splash\s*=\s*"done"/);
  });

  it("keeps the hard timeout that stops the splash trapping anyone", () => {
    expect(script).toMatch(/MAX_MS/);
    expect(script).toMatch(/setTimeout\(\s*\n?\s*dismiss/);
  });
});

describe("the stylesheet that now does the hiding", () => {
  const css = readFileSync("app/globals.css", "utf8");

  it("hides the splash whenever it is not active", () => {
    // Without this rule, dropping removeChild would leave the splash on
    // screen forever — the fix depends on it.
    expect(css).toMatch(/html:not\(\[data-splash="active"\]\)\s*\.app-splash\s*\{[^}]*display:\s*none/);
  });
});
