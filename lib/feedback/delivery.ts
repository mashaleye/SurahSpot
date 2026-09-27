import "server-only";
import { feedbackDeliveryConfig } from "@/lib/config/env";
import { unavailable, upstreamError } from "@/lib/http/api-error";

/**
 * Getting a visitor's message to a human.
 *
 * Two transports, tried in order: Resend, then a generic webhook. Resend is
 * called over its REST API rather than through its SDK — the call is one
 * fetch, and an API key that can send mail as this domain is not a dependency
 * worth widening the supply chain for.
 *
 * Every message a visitor sees from here is deliberately generic. Failures
 * name the cause only in the server log, because an AppError's message is
 * returned in the response body: a misconfiguration notice listing the
 * server's environment variables would be sent to whoever triggered it.
 */

export type FeedbackMessage = {
  name: string;
  email: string;
  message: string;
  userAgent?: string;
};

/** What a visitor is told when delivery fails, whatever the reason. */
const GENERIC_FAILURE = "Your message could not be sent right now. Please try again shortly.";

/**
 * Long enough for a slow provider, short enough that a hung connection does
 * not hold the request open until the platform kills it.
 */
const SEND_TIMEOUT_MS = 10_000;

/** One retry, for the failures that are worth retrying. */
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 600;

/**
 * Strip control characters from anything that lands in a header-like field.
 *
 * The JSON API encodes these fields itself, so this is not the last line of
 * defence — but a newline in a subject line is the classic header-injection
 * vector, and the cost of removing it is nil.
 */
function headerSafe(value: string, limit: number) {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit);
}

function textBody(feedback: FeedbackMessage) {
  return [
    "SurahSpot feedback",
    "",
    `Name: ${feedback.name || "Not provided"}`,
    `Email: ${feedback.email || "Not provided"}`,
    `User agent: ${feedback.userAgent || "Not provided"}`,
    `Received: ${new Date().toISOString()}`,
    "",
    feedback.message,
  ].join("\n");
}

/** 429 and 5xx are the provider having a moment; 4xx is us, and will not fix itself. */
function worthRetrying(status: number) {
  return status === 429 || status >= 500;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function postJson(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
}

async function sendWithResend(feedback: FeedbackMessage) {
  const config = feedbackDeliveryConfig();
  if (!config.resendApiKey || !config.toEmail || !config.fromEmail) return false;

  const payload = JSON.stringify({
    from: config.fromEmail,
    to: [config.toEmail],
    /*
     * The visitor's address goes here, never in `from`. They do not own the
     * sending domain, so using it as the sender would fail SPF and DKIM and
     * train receivers to distrust this domain. In Reply-To it does exactly
     * what is wanted: hitting reply in the inbox answers the visitor.
     */
    reply_to: feedback.email || undefined,
    subject: feedback.name
      ? headerSafe(`SurahSpot feedback from ${feedback.name}`, 200)
      : "SurahSpot feedback",
    text: textBody(feedback),
  });

  let lastStatus = 0;
  let lastDetail = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await postJson("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: payload,
      });
    } catch (error) {
      // A timeout or a network fault. Worth one more try before giving up.
      if (attempt < MAX_ATTEMPTS) {
        await wait(RETRY_DELAY_MS);
        continue;
      }
      throw upstreamError(GENERIC_FAILURE, {
        context: { provider: "resend", reason: error instanceof Error ? error.name : "network" },
      });
    }

    if (response.ok) return true;

    lastStatus = response.status;
    lastDetail = (await response.text().catch(() => "")).slice(0, 500);

    if (attempt < MAX_ATTEMPTS && worthRetrying(response.status)) {
      await wait(RETRY_DELAY_MS);
      continue;
    }
    break;
  }

  /*
   * The provider's own detail goes to the log, not to the response. A 403
   * from Resend says which domain is unverified, which is useful to whoever
   * runs this and nobody else.
   */
  throw upstreamError(GENERIC_FAILURE, {
    context: { provider: "resend", status: lastStatus, detail: lastDetail },
  });
}

async function sendWithWebhook(feedback: FeedbackMessage) {
  const config = feedbackDeliveryConfig();
  if (!config.webhookUrl) return false;

  let url: URL;
  try {
    url = new URL(config.webhookUrl);
  } catch {
    throw unavailable(GENERIC_FAILURE, {
      context: { provider: "webhook", reason: "FEEDBACK_WEBHOOK_URL is not a valid URL" },
    });
  }
  if (url.protocol !== "https:") {
    throw unavailable(GENERIC_FAILURE, {
      context: { provider: "webhook", reason: "FEEDBACK_WEBHOOK_URL must be https" },
    });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.webhookSecret) headers.Authorization = `Bearer ${config.webhookSecret}`;
  const body = JSON.stringify({ ...feedback, receivedAt: new Date().toISOString() });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await postJson(url.toString(), { method: "POST", headers, body });
    } catch (error) {
      if (attempt < MAX_ATTEMPTS) {
        await wait(RETRY_DELAY_MS);
        continue;
      }
      throw upstreamError(GENERIC_FAILURE, {
        context: { provider: "webhook", host: url.hostname, reason: error instanceof Error ? error.name : "network" },
      });
    }

    if (response.ok) return true;

    if (attempt < MAX_ATTEMPTS && worthRetrying(response.status)) {
      await wait(RETRY_DELAY_MS);
      continue;
    }

    throw upstreamError(GENERIC_FAILURE, {
      context: { provider: "webhook", status: response.status, host: url.hostname },
    });
  }

  return true;
}

export async function deliverFeedback(feedback: FeedbackMessage) {
  if (await sendWithResend(feedback)) return;
  if (await sendWithWebhook(feedback)) return;

  /*
   * Nothing is configured. The visitor is told the form is unavailable; the
   * log says exactly which variables are missing, because that message would
   * otherwise be handed to whoever filled in the form.
   */
  throw unavailable("Feedback is not available right now. Please try again later.", {
    context: {
      reason: "No delivery transport configured",
      expected: "RESEND_API_KEY + FEEDBACK_TO_EMAIL (or CONTACT_TO_EMAIL), or FEEDBACK_WEBHOOK_URL",
    },
  });
}
