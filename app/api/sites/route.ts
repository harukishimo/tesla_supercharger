import { listSites } from "@/lib/server/queue-service";
import { route } from "@/lib/server/route-utils";

export const runtime = "nodejs";

export async function GET() {
  return route(async () => ({ sites: (await listSites()).map((site) => ({
    id: site.id, name: site.name, address: site.address, prefecture: site.prefecture ?? null,
    municipality: site.municipality ?? null, searchText: site.normalizedSearchText ?? site.name,
    stallCount: site.stallCount,
  })) }));
}
