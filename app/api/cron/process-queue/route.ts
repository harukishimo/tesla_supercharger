import { processQueue } from "@/lib/server/queue-service";
import { ApiError, jsonError, jsonData } from "@/lib/server/errors";
import { cronAuthorized } from "@/lib/server/config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return jsonError(new ApiError("UNEXPECTED_ERROR", 403, false));
  try { return jsonData(await processQueue()); } catch (error) { return jsonError(error); }
}
