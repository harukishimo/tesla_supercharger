import { getMyQueue } from "@/lib/server/queue-service";
import { ApiError } from "@/lib/server/errors";
import { requireUuid, route } from "@/lib/server/route-utils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return route(async () => {
    const entryId = requireUuid(new URL(request.url).searchParams.get("entryId"));
    const token = request.headers.get("x-queue-token") ?? "";
    if (!entryId || !token) throw new ApiError("MANAGEMENT_TOKEN_INVALID");
    return getMyQueue(entryId, token);
  });
}
