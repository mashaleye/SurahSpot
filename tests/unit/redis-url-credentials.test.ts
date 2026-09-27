import { describe, expect, it } from "vitest";

import { credentialsFrom } from "@/lib/store/redis-store";

/**
 * The shape of a Redis URL decides whether the connection authenticates at all.
 *
 * `fly redis status` prints `redis://PASSWORD@host` — one credential, no colon.
 * The WHATWG URL parser puts that in `url.username`, leaving `url.password`
 * empty, so reading only `url.password` skipped AUTH entirely. The socket still
 * opened, so nothing looked wrong at startup; every command then failed with
 * NOAUTH at runtime, and the store had already been chosen over the in-memory
 * fallback. Pasting the provider's own URL verbatim was enough to cause it.
 */

describe("credentialsFrom", () => {
  it("treats a lone credential as the password, not the username", () => {
    // The form `fly redis status` prints.
    expect(credentialsFrom(new URL("redis://s3cret@fly-x.upstash.io"))).toEqual({
      username: "",
      password: "s3cret",
    });
  });

  it("keeps a genuine username/password pair intact", () => {
    expect(credentialsFrom(new URL("redis://default:s3cret@fly-x.upstash.io"))).toEqual({
      username: "default",
      password: "s3cret",
    });
  });

  it("handles the explicit password-only form", () => {
    // redis://:PASSWORD@host — an empty username before the colon.
    expect(credentialsFrom(new URL("redis://:s3cret@fly-x.upstash.io"))).toEqual({
      username: "",
      password: "s3cret",
    });
  });

  it("reports no credentials for a URL that carries none", () => {
    expect(credentialsFrom(new URL("redis://localhost:6379"))).toEqual({
      username: "",
      password: "",
    });
  });

  it("percent-decodes credentials", () => {
    /*
     * Generated passwords contain URL-reserved characters, and a provider
     * percent-encodes them. Sending the encoded form as the password
     * authenticates with the wrong string — which reads as a wrong password
     * rather than as an encoding bug.
     */
    expect(credentialsFrom(new URL("redis://p%40ss%3Aword@host"))).toEqual({
      username: "",
      password: "p@ss:word",
    });

    expect(credentialsFrom(new URL("redis://default:p%2Fw%23d@host"))).toEqual({
      username: "default",
      password: "p/w#d",
    });
  });

  it("does not mistake a password for a username in either form", () => {
    // The distinction that matters: both of these must AUTH with one argument,
    // because AUTH with two requires Redis 6 ACLs and a real ACL user.
    for (const url of ["redis://tok@host", "redis://:tok@host"]) {
      const { username, password } = credentialsFrom(new URL(url));
      expect(password, url).toBe("tok");
      expect(username, url).toBe("");
    }
  });
});

describe("URL shapes the store must accept", () => {
  it("defaults to port 6379 when the URL omits it", () => {
    // Fly's printed URL has no port.
    const url = new URL("redis://s3cret@fly-x.upstash.io");
    expect(url.port).toBe("");
    expect(Number(url.port || 6379)).toBe(6379);
  });

  it("distinguishes TLS by scheme", () => {
    expect(new URL("redis://host").protocol).toBe("redis:");
    expect(new URL("rediss://host").protocol).toBe("rediss:");
  });
});
