import { ApiError } from "./errors";

export const TERMS_VERSION = process.env.QUEUE_TERMS_VERSION ?? "2026-07-22";

export function requireDatabaseUrl(): string {
  const value = process.env.SUPABASE_DATABASE_URL;
  if (!value) throw new ApiError("CONFIGURATION_ERROR");
  // Do not log or interpolate this value anywhere. URL parsing only validates
  // that accidental non-URLs are rejected without exposing the secret.
  try { new URL(value); } catch { throw new ApiError("CONFIGURATION_ERROR"); }
  return value;
}

export function cronAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = request.headers.get("x-cron-secret") ?? authorization.replace(/^Bearer\s+/i, "");
  return supplied.length > 0 && supplied === expected;
}
