import { joinQueue } from "@/lib/server/queue-service";
import { requireUuid, route, parseJson } from "@/lib/server/route-utils";
import { verifyTurnstile } from "@/lib/server/turnstile";
import { assertJoinRateLimit } from "@/lib/server/rate-limit";
import { idempotent } from "@/lib/server/idempotency";
import { ApiError } from "@/lib/server/errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return route(async () => {
    const body = await parseJson(request);
    const siteId = requireUuid(typeof body.siteId === "string" ? body.siteId : "", "FACILITY_NOT_FOUND");
    assertJoinRateLimit(request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for"), siteId);
    const input = {
      siteId,
      nickname: body.nickname,
      siteIsFull: body.siteIsFull,
      acceptedTerms: body.acceptedTerms,
      termsVersion: body.termsVersion,
    };
    const idempotencyKey = request.headers.get("idempotency-key");
    const result = await idempotent("queue:join", idempotencyKey, input, async () => {
      try {
        // First perform a facility-locked replay check without consuming the
        // single-use Turnstile token. A duplicate can safely return the
        // deterministic existing token from the active-entry claim.
        return await joinQueue({ ...input, idempotencyKey, turnstileVerified: false });
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "CAPTCHA_FAILED") throw error;
        await verifyTurnstile(body.turnstileToken, request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for"));
        return joinQueue({ ...input, idempotencyKey, turnstileVerified: true });
      }
    });
    return { entryId: result.entryId, managementToken: result.token, snapshot: result.snapshot };
  });
}
