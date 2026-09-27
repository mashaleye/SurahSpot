import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteClient } from "../helpers/route-client";
import { POST as feedbackRoute } from "@/app/api/feedback/route";

/**
 * The feedback endpoint is the only unauthenticated thing here that causes
 * email to be sent, which makes it the most attractive target on the site.
 * These cover the order the checks run in as much as the checks themselves —
 * validating before rate limiting would let a bot hammer it for free.
 */

const URL = "http://localhost:3000/api/feedback";
const ORIGINAL = { ...process.env };

let sent: Array<Record<string, unknown>>;

function newClient(ip: string) {
  const client = new RouteClient();
  // A distinct IP per test, so one test's rate-limit budget is not another's.
  const original = client.call.bind(client);
  client.call = ((handler: any, url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("x-forwarded-for", ip);
    return original(handler, url, { ...init, headers });
  }) as typeof client.call;
  return client;
}

const good = { name: "Aisha", email: "aisha@example.com", message: "Thank you for building this." };

beforeEach(() => {
  sent = [];
  process.env.RATE_LIMIT_ENABLED = "true";
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.FEEDBACK_TO_EMAIL = "reggie@example.com";

  vi.stubGlobal("fetch", async (_url: string, init: RequestInit = {}) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response("{}", { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL };
});

describe("accepting a message", () => {
  it("sends a valid submission", async () => {
    const result = await newClient("10.0.0.1").post(feedbackRoute, URL, good);
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("accepts a message with no name or email", async () => {
    // Both fields are marked optional in the form; the API must agree.
    const result = await newClient("10.0.0.2").post(feedbackRoute, URL, { message: "Anonymous but useful." });
    expect(result.status).toBe(200);
    expect(sent).toHaveLength(1);
  });
});

describe("rejecting a bad one", () => {
  it("rejects a too-short message", async () => {
    const result = await newClient("10.0.0.3").post(feedbackRoute, URL, { message: "hi" });
    expect(result.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("rejects an over-long message", async () => {
    const result = await newClient("10.0.0.4").post(feedbackRoute, URL, { message: "x".repeat(3001) });
    expect(result.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("rejects a malformed email address", async () => {
    const result = await newClient("10.0.0.5").post(feedbackRoute, URL, { ...good, email: "not-an-address" });
    expect(result.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("rejects a non-object body", async () => {
    const client = newClient("10.0.0.6");
    const result = await client.call(feedbackRoute, URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json at all",
    });
    expect(result.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("refuses an oversized body before parsing it", async () => {
    const client = newClient("10.0.0.7");
    const result = await client.call(feedbackRoute, URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "content-length": String(17 * 1024) },
      body: JSON.stringify(good),
    });
    expect(result.status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});

describe("the honeypot", () => {
  it("silently accepts a filled trap without sending anything", async () => {
    const result = await newClient("10.0.0.8").post(feedbackRoute, URL, { ...good, company: "Acme Ltd" });

    // Same response a real submission gets, so a bot learns nothing.
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(sent).toHaveLength(0);
  });
});

describe("rate limiting", () => {
  it("caps how many messages one client can send in an hour", async () => {
    const client = newClient("10.0.1.1");

    for (let i = 0; i < 5; i += 1) {
      const result = await client.post(feedbackRoute, URL, { ...good, message: `Message number ${i}` });
      expect(result.status).toBe(200);
    }

    const blocked = await client.post(feedbackRoute, URL, { ...good, message: "One too many." });
    expect(blocked.status).toBe(429);
    expect(blocked.response.headers.get("Retry-After")).toBeTruthy();
    expect(sent).toHaveLength(5);
  });

  it("does not spend the send budget on rejected submissions", async () => {
    // Someone mistyping their address three times must still be able to
    // reach a human afterwards.
    const client = newClient("10.0.1.2");

    for (let i = 0; i < 3; i += 1) {
      const rejected = await client.post(feedbackRoute, URL, { ...good, email: "bad" });
      expect(rejected.status).toBe(400);
    }

    const result = await client.post(feedbackRoute, URL, good);
    expect(result.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("stops an endpoint hammered with junk, even though none of it validates", async () => {
    const client = newClient("10.0.1.3");

    let sawLimit = false;
    for (let i = 0; i < 25; i += 1) {
      const result = await client.post(feedbackRoute, URL, { message: "x" });
      if (result.status === 429) { sawLimit = true; break; }
    }

    expect(sawLimit).toBe(true);
  });
});

describe("what the visitor is told", () => {
  it("does not name the server's environment variables when unconfigured", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.FEEDBACK_TO_EMAIL;
    delete process.env.CONTACT_TO_EMAIL;
    delete process.env.FEEDBACK_WEBHOOK_URL;

    const result = await newClient("10.0.2.1").post(feedbackRoute, URL, good);
    expect(result.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(result.body)).not.toMatch(/RESEND_API_KEY|FEEDBACK_|CONTACT_/);
  });

  it("does not leak the provider's error detail", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ message: "mail.surahspot.com is not verified" }), { status: 403 }));

    const result = await newClient("10.0.2.2").post(feedbackRoute, URL, good);
    expect(JSON.stringify(result.body)).not.toContain("not verified");
  });
});
