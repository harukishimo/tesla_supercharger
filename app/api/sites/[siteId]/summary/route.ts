import { getSiteSummary } from "@/lib/server/queue-service";
import { requireUuid, route } from "@/lib/server/route-utils";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ siteId: string }> }) {
  return route(async () => getSiteSummary(requireUuid((await context.params).siteId, "FACILITY_NOT_FOUND")));
}
