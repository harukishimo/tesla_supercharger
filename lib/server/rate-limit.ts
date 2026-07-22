import { ApiError } from "./errors";

type Counter = { count: number; resetAt: number };

// This is intentionally a small, dependency-free guard for the MVP. Vercel
// instances do not share memory, so it is a first-line throttle rather than a
// replacement for an operator-managed edge/WAF rate limit.
const counters = new Map<string, Counter>();
const MAX_ENTRIES = 10_000;

export function assertJoinRateLimit(ipHeader: string | null, siteId: string): void {
  const ip = (ipHeader ?? "unknown").split(",", 1)[0]?.trim().slice(0, 64) || "unknown";
  const key = `${ip}:${siteId}`;
  const now = Date.now();
  const current = counters.get(key);
  if (!current || current.resetAt <= now) {
    if (counters.size >= MAX_ENTRIES) {
      const oldest = counters.keys().next().value;
      if (oldest) counters.delete(oldest);
    }
    counters.set(key, { count: 1, resetAt: now + 60_000 });
    return;
  }
  current.count += 1;
  if (current.count > 8) throw new ApiError("RATE_LIMITED");
}

export function clearRateLimitForTests(): void {
  counters.clear();
}
