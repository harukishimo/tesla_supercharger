import { cancelQueue } from "@/lib/server/queue-service";
import { parseJson, requireUuid, route } from "@/lib/server/route-utils";
import { ApiError } from "@/lib/server/errors";
import { idempotent } from "@/lib/server/idempotency";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return route(async () => {
    const body = await parseJson(request); const entryId = requireUuid(typeof body.entryId === "string" ? body.entryId : "");
    const token = request.headers.get("x-queue-token") ?? "";
    if (!entryId || !token) throw new ApiError("MANAGEMENT_TOKEN_INVALID");
    const idempotencyKey = request.headers.get("idempotency-key");
    return { status: "cancelled", ...(await idempotent("queue:cancel", idempotencyKey, { entryId, token }, () => cancelQueue(entryId, token, new Date(), { key: idempotencyKey, fingerprint: { entryId, token } }))) };
  });
}
