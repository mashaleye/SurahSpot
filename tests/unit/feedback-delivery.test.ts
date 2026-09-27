import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The feedback path is the one place a visitor's words leave the app, and
 * every way it can go wrong is quiet: a message that never arrives, a
 * misconfiguration notice shown to the person who filled in the form, a
 * sender address that fails SPF. None of it surfaces as a broken page.
 */

const ORIGINAL = { ...process.env };

type FetchCall = { url: string; init: RequestInit };
let calls: FetchCall[];

function mockFetch(responder: (call: FetchCall, attempt: number) => Response | Promise<Response> | never) {
  let attempt = 0;
  vi.stubGlobal("fetch", async (url: string | URL | Request, init: RequestInit = {}) => {
    attempt += 1;
    const call = { url: String(url), init };
    calls.push(call);
    return responder(call, attempt);
  });
}

const load = async () => {
  vi.resetModules();
  return import("@/lib/feedback/delivery");
};

const feedback = (overrides: Partial<{ name: string; email: string; message: string; userAgent: string }> = {}) => ({
  name: "Aisha",
  email: "aisha@example.com",
  message: "The reader is lovely, thank you.",
  ...overrides,
});

function bodyOf(call: FetchCall) {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  calls = [];
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.FEEDBACK_TO_EMAIL = "reggie@example.com";
  delete process.env.FEEDBACK_FROM_EMAIL;
  delete process.env.CONTACT_TO_EMAIL;
  delete process.env.CONTACT_FROM_EMAIL;
  delete process.env.FEEDBACK_WEBHOOK_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL };
});

describe("sending through Resend", () => {
  it("posts the message to Resend", async () => {
    mockFetch(() => new Response(JSON.stringify({ id: "abc" }), { status: 200 }));
    const { deliverFeedback } = await load();
    await deliverFeedback(feedback());

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    expect(bodyOf(calls[0]).to).toEqual(["reggie@example.com"]);
  });

  it("sends from the verified domain and puts the visitor in reply_to", async () => {
    // The visitor does not own the sending domain: using their address as the
    // sender fails SPF and DKIM and damages this domain's reputation.
    mockFetch(() => new Response("{}", { status: 200 }));
    const { deliverFeedback } = await load();
    await deliverFeedback(feedback());

    const body = bodyOf(calls[0]);
    expect(String(body.from)).toContain("mail.surahspot.com");
    expect(String(body.from)).not.toContain("aisha@example.com");
    expect(body.reply_to).toBe("aisha@example.com");
  });

  it("omits reply_to when no address was given", async () => {
    mockFetch(() => new Response("{}", { status: 200 }));
    const { deliverFeedback } = await load();
    await deliverFeedback(feedback({ email: "" }));
    expect(bodyOf(calls[0]).reply_to).toBeUndefined();
  });

  it("carries the message and the context a reply needs", async () => {
    mockFetch(() => new Response("{}", { status: 200 }));
    const { deliverFeedback } = await load();
    await deliverFeedback(feedback({ userAgent: "Mozilla/5.0 (iPhone)" }));

    const text = String(bodyOf(calls[0]).text);
    expect(text).toContain("The reader is lovely, thank you.");
    expect(text).toContain("aisha@example.com");
    expect(text).toContain("Mozilla/5.0 (iPhone)");
  });

  it("strips control characters from the subject", async () => {
    // A newline in a subject line is the classic header-injection vector.
    mockFetch(() => new Response("{}", { status: 200 }));
    const { deliverFeedback } = await load();
    await deliverFeedback(feedback({ name: "Aisha\r\nBcc: someone@evil.test" }));

    const subject = String(bodyOf(calls[0]).subject);
    expect(subject).not.toContain("\r");
    expect(subject).not.toContain("\n");
  });
});

describe("configuration", () => {
  it("accepts CONTACT_TO_EMAIL as well as FEEDBACK_TO_EMAIL", async () => {
    // Most Resend walkthroughs use the CONTACT_ names. Reading only one pair
    // turns a correct-looking .env.local into a silent "not configured".
    delete process.env.FEEDBACK_TO_EMAIL;
    process.env.CONTACT_TO_EMAIL = "reggie@example.com";

    mockFetch(() => new Response("{}", { status: 200 }));
    const { deliverFeedback } = await load();
    await deliverFeedback(feedback());
    expect(bodyOf(calls[0]).to).toEqual(["reggie@example.com"]);
  });

  it("lets an explicit From address override the default", async () => {
    process.env.FEEDBACK_FROM_EMAIL = "Hello <hello@mail.surahspot.com>";
    mockFetch(() => new Response("{}", { status: 200 }));
    const { deliverFeedback } = await load();
    await deliverFeedback(feedback());
    expect(bodyOf(calls[0]).from).toBe("Hello <hello@mail.surahspot.com>");
  });

  it("refuses without telling the visitor how the server is wired", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.FEEDBACK_TO_EMAIL;

    const { deliverFeedback } = await load();
    const error = await deliverFeedback(feedback()).catch((e: Error) => e);

    // The message becomes the response body, so it must not name variables.
    expect((error as Error).message).not.toMatch(/RESEND_API_KEY|FEEDBACK_|CONTACT_/);
    // The detail belongs in the log, which is what `context` is for.
    expect((error as Error & { context?: Record<string, unknown> }).context?.expected)
      .toMatch(/RESEND_API_KEY/);
  });
});

describe("failures", () => {
  it("retries a 5xx once, then succeeds", async () => {
    mockFetch((_call, attempt) =>
      attempt === 1 ? new Response("upstream wobble", { status: 503 }) : new Response("{}", { status: 200 }));

    const { deliverFeedback } = await load();
    await deliverFeedback(feedback());
    expect(calls).toHaveLength(2);
  });

  it("retries a 429 once", async () => {
    mockFetch((_call, attempt) =>
      attempt === 1 ? new Response("slow down", { status: 429 }) : new Response("{}", { status: 200 }));

    const { deliverFeedback } = await load();
    await deliverFeedback(feedback());
    expect(calls).toHaveLength(2);
  });

  it("does not retry a 4xx, which will not fix itself", async () => {
    mockFetch(() => new Response(JSON.stringify({ message: "domain is not verified" }), { status: 403 }));
    const { deliverFeedback } = await load();
    await expect(deliverFeedback(feedback())).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("retries a network fault once", async () => {
    mockFetch((_call, attempt) => {
      if (attempt === 1) throw new TypeError("fetch failed");
      return new Response("{}", { status: 200 });
    });

    const { deliverFeedback } = await load();
    await deliverFeedback(feedback());
    expect(calls).toHaveLength(2);
  });

  it("keeps the provider's detail out of the visitor's response", async () => {
    mockFetch(() => new Response(JSON.stringify({ message: "The domain mail.surahspot.com is not verified" }), { status: 403 }));

    const { deliverFeedback } = await load();
    const error = await deliverFeedback(feedback()).catch((e: Error) => e);

    expect((error as Error).message).not.toContain("not verified");
    const context = (error as Error & { context?: Record<string, unknown> }).context;
    expect(String(context?.detail)).toContain("not verified");
    expect(context?.status).toBe(403);
  });

  it("gives the visitor the same message whatever went wrong", async () => {
    mockFetch(() => new Response("teapot", { status: 418 }));
    const { deliverFeedback } = await load();
    const error = await deliverFeedback(feedback()).catch((e: Error) => e);
    expect((error as Error).message).toBe("Your message could not be sent right now. Please try again shortly.");
  });
});

describe("the webhook transport", () => {
  it("is used when Resend is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.FEEDBACK_WEBHOOK_URL = "https://hooks.example.com/surahspot";

    mockFetch(() => new Response("{}", { status: 200 }));
    const { deliverFeedback } = await load();
    await deliverFeedback(feedback());

    expect(calls[0].url).toBe("https://hooks.example.com/surahspot");
    expect(bodyOf(calls[0]).message).toBe("The reader is lovely, thank you.");
  });

  it("refuses a plaintext webhook, which would put the message on the wire", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.FEEDBACK_WEBHOOK_URL = "http://hooks.example.com/surahspot";

    const { deliverFeedback } = await load();
    await expect(deliverFeedback(feedback())).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("sends the shared secret when one is set", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.FEEDBACK_WEBHOOK_URL = "https://hooks.example.com/surahspot";
    process.env.FEEDBACK_WEBHOOK_SECRET = "s3cret";

    mockFetch(() => new Response("{}", { status: 200 }));
    const { deliverFeedback } = await load();
    await deliverFeedback(feedback());
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer s3cret");
  });
});
