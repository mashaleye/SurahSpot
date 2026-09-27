import { NextRequest, NextResponse } from "next/server";
import { deliverFeedback } from "@/lib/feedback/delivery";
import { badRequest, toErrorResponse } from "@/lib/http/api-error";
import { enforceRateLimit, rateLimitIdentities } from "@/lib/http/rate-limit";
import { rateLimits } from "@/lib/config/env";

export const dynamic = "force-dynamic";
const ROUTE = "api/feedback";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Two budgets, because they protect different things.
 *
 * The request budget stops the endpoint being hammered at all, and is checked
 * before anything is parsed or validated. The send budget is what stops it
 * becoming a free email relay, and is only spent on a message that was
 * actually accepted — so a visitor who mistypes their address three times
 * does not lose their ability to reach anyone.
 */
const REQUESTS_PER_HOUR = 20;
const SENDS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The largest body worth reading. The fields cap out around 3KB; anything at
 * this size is not a person filling in a form, and parsing it is work done on
 * an attacker's behalf.
 */
const MAX_BODY_BYTES = 16 * 1024;

type FeedbackBody = { name?: unknown; email?: unknown; message?: unknown; company?: unknown };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const limits = rateLimits();
    const identities = rateLimitIdentities(request);

    // Before parsing: an unparsed request is the cheapest one to refuse.
    if (limits.enabled) {
      await enforceRateLimit("feedback-request", identities, REQUESTS_PER_HOUR, HOUR_MS);
    }

    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      throw badRequest("Message is too long.");
    }

    const body = (await request.json().catch(() => null)) as FeedbackBody | null;
    if (!body || typeof body !== "object") throw badRequest("Invalid feedback request.");

    // Honeypot submissions get the same successful response as real ones so a
    // bot cannot use the endpoint to discover the trap. Nothing is sent, and
    // no send budget is spent.
    if (text(body.company)) return NextResponse.json({ ok: true });

    const name = text(body.name);
    const email = text(body.email);
    const message = text(body.message);

    if (name.length > 80) throw badRequest("Name is too long.");
    if (email.length > 160 || (email && !EMAIL.test(email))) throw badRequest("Enter a valid email address.");
    if (message.length < 4) throw badRequest("Please enter a little more detail.");
    if (message.length > 3000) throw badRequest("Message is too long.");

    // Only now, on a message that will actually be delivered.
    if (limits.enabled) {
      await enforceRateLimit("feedback-send", identities, SENDS_PER_HOUR, HOUR_MS);
    }

    await deliverFeedback({
      name,
      email,
      message,
      userAgent: request.headers.get("user-agent")?.slice(0, 300) || undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error, ROUTE);
  }
}
