import { NextRequest, NextResponse } from "next/server";
import { ATTEMPT_COOKIE_NAME, loadAttempt } from "@/lib/game/attempt-service";
import { MAX_ATTEMPT_ROUNDS } from "@/lib/game/rules";
import { conflict, toErrorResponse } from "@/lib/http/api-error";
import { enforceRateLimit, rateLimitIdentities } from "@/lib/http/rate-limit";
import { rateLimits } from "@/lib/config/env";
import { shareResultFromAttempt } from "@/lib/share/result-from-attempt";
import { formatShareResultText } from "@/lib/share/result-copy";
import { sealShareResult } from "@/lib/share/result-token";

export const dynamic = "force-dynamic";

const ROUTE = "api/share/result";

export async function POST(request: NextRequest) {
  try {
    const attemptId = request.cookies.get(ATTEMPT_COOKIE_NAME)?.value;
    const attempt = await loadAttempt(attemptId);
    if (!attempt || attempt.roundsCompleted < MAX_ATTEMPT_ROUNDS) {
      throw conflict("Finish the seven-round attempt before sharing its result.");
    }
    if (attempt.shareStats.roundStates.length !== attempt.roundsCompleted) {
      throw conflict("Start a new attempt to create a verified share result.");
    }

    const limits = rateLimits();
    if (limits.enabled) {
      await enforceRateLimit("action", rateLimitIdentities(request, attemptId), limits.actionPerMinute);
    }

    const result = shareResultFromAttempt(attempt);
    const token = sealShareResult(result);
    const path = `/r/${encodeURIComponent(token)}`;

    return NextResponse.json({
      path,
      cardPath: `/api/share/card/result/${encodeURIComponent(token)}`,
      title: "My SurahSpot result",
      // The client swaps this placeholder for its own trusted origin. Keeping
      // Host out of the signed/copy data avoids trusting forwarded host headers.
      textTemplate: formatShareResultText(result, "{{SHARE_URL}}"),
      result,
    });
  } catch (error) {
    return toErrorResponse(error, ROUTE);
  }
}
