import { ApiError } from "./errors";

/** Fast-path request deduplication for concurrent retries while a server instance lives.
 * The caller still relies on the facility transaction for state integrity;
 * this cache is deliberately bounded so an attacker cannot grow it forever.
 * A duplicate key with a different request body is rejected rather than
 * silently executing a second operation. */
const cache = new Map<string, { fingerprint: string; value: Promise<unknown>; expiresAt: number }>();
const TTL = 10 * 60_000;
const MAX_ENTRIES = 2_000;

export async function idempotent<T>(scope: string, key: string | null, fingerprint: unknown, operation: () => Promise<T>): Promise<T> {
  if (!key) return operation();
  const normalized = key.trim();
  if (!normalized || normalized.length > 256) return operation();
  const now = Date.now();
  for (const [entryKey, value] of cache) if (value.expiresAt <= now) cache.delete(entryKey);
  const cacheKey = `${scope}:${normalized}`;
  const serialized = JSON.stringify(fingerprint);
  const previous = cache.get(cacheKey);
  if (previous && previous.fingerprint === serialized) return previous.value as Promise<T>;
  if (previous) throw new ApiError("IDEMPOTENCY_KEY_REUSED");
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  const value = operation();
  cache.set(cacheKey, { fingerprint: serialized, value, expiresAt: now + TTL });
  try {
    const result = await value;
    // Durable active-entry hashes handle later retries. Do not retain a
    // successful response (which may contain the one-time token) in memory.
    if (cache.get(cacheKey)?.value === value) cache.delete(cacheKey);
    return result;
  } catch (error) { cache.delete(cacheKey); throw error; }
}
