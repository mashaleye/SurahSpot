import { describe, expect, it } from "vitest";

import { classifySetupError } from "@/lib/game/setup-error";

/**
 * The panel this feeds used to have one catch-all branch that asserted "Your
 * Quran Foundation connection is working. This error came from a round/audio
 * resource request" and then explained reciter fallback. A store failure hit
 * that branch, so the page confidently blamed the wrong subsystem — someone
 * debugging it would check their credentials and re-read the reciter logic
 * while the actual cause was an unreachable Redis.
 *
 * The real message that exposed it is the first case below.
 */

describe("store failures", () => {
  it("recognises the Fly-private Redis URL left in a local env file", () => {
    /*
     * The shape of the reported failure, with the host generalised — a managed
     * store's hostname is deployment detail and does not belong in the test
     * suite. What matters is the shape: a bare getaddrinfo failure naming a
     * managed store host, which is what a laptop gets when a provider-private
     * URL is left in .env.local.
     */
    expect(classifySetupError("getaddrinfo ENOTFOUND fly-example-1234.upstash.io")).toBe("store");
  });

  it("recognises the store by name, provider, or variable", () => {
    for (const message of [
      "Redis connection closed.",
      "connect ECONNREFUSED 127.0.0.1:6379",
      "ATTEMPT_STORE_URL is not a valid URL",
      "No shared attempt store is configured.",
      "valkey handshake failed",
    ]) {
      expect(classifySetupError(message), message).toBe("store");
    }
  });

  it("recognises a Redis-level auth rejection", () => {
    // The failure mode when AUTH is skipped or the password is wrong — which is
    // exactly what the single-credential URL bug produced.
    expect(classifySetupError("NOAUTH Authentication required.")).toBe("store");
    expect(classifySetupError("WRONGPASS invalid username-password pair")).toBe("store");
  });

  it("attributes a bare network errno to the store", () => {
    // Nothing in these names the upstream, and the upstream path names what it
    // was fetching, so an unattributed connect failure is the store's.
    for (const message of [
      "getaddrinfo EAI_AGAIN some-host.internal",
      "connect ETIMEDOUT 10.0.0.5:6379",
      "read ECONNRESET",
    ]) {
      expect(classifySetupError(message), message).toBe("store");
    }
  });
});

describe("configuration failures", () => {
  it("recognises missing or rejected Quran Foundation credentials", () => {
    for (const message of [
      "Missing QF_CLIENT_ID",
      "client_secret is not set",
      "Token request failed",
      "Upstream returned 401",
      "Upstream returned 403",
    ]) {
      expect(classifySetupError(message), message).toBe("configuration");
    }
  });

  it("prefers a credential diagnosis over a network one", () => {
    /*
     * A 401 alongside a connection detail is a rejected credential, not an
     * unreachable host. "Your credentials are wrong" is both more specific and
     * more actionable than "something could not be reached".
     */
    expect(classifySetupError("connect ECONNREFUSED — token request failed (401)")).toBe(
      "configuration",
    );
  });
});

describe("round and upstream failures", () => {
  it("keeps content and audio failures in the round branch", () => {
    for (const message of [
      "Chapter 103 has no audio for the selected reciter.",
      "Could not build a round for chapter 2.",
      "Translation 131 is unavailable.",
    ]) {
      expect(classifySetupError(message), message).toBe("round");
    }
  });

  it("does not claim a named upstream host for the store", () => {
    // A network errno that names Quran Foundation belongs upstream, not to the
    // store — otherwise a QF outage would send someone to inspect Redis, the
    // same mistake in the opposite direction.
    expect(classifySetupError("getaddrinfo ENOTFOUND apis.quran.foundation")).toBe("round");
    expect(classifySetupError("ECONNRESET while fetching recitation audio")).toBe("round");
  });

  it("falls back to the round branch for anything unrecognised", () => {
    expect(classifySetupError("Something went wrong.")).toBe("round");
    expect(classifySetupError("")).toBe("round");
  });

  it("tolerates a non-string without throwing", () => {
    // setupError is typed as a string, but it is populated from caught values.
    expect(classifySetupError(undefined as unknown as string)).toBe("round");
    expect(classifySetupError(null as unknown as string)).toBe("round");
  });
});
