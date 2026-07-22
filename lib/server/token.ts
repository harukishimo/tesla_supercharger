import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Generate a 256-bit queue token. The plaintext must only be returned once. */
export function createQueueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashQueueToken(token: string): Uint8Array {
  return createHash("sha256").update(token, "utf8").digest();
}

export function hashRequestKey(key: string): Uint8Array {
  return createHash("sha256").update(key, "utf8").digest();
}

export function hashRequestFingerprint(value: unknown): Uint8Array {
  return hashRequestKey(JSON.stringify(value));
}

/**
 * Make retries that land on another Vercel instance recover the same token
 * without ever persisting the token plaintext. Production must provide a
 * stable server-only secret; the fallback is intentionally development-only.
 */
export function createIdempotentQueueToken(key: string): string {
  const secret = process.env.QUEUE_IDEMPOTENCY_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "supercharge-queue-development-only");
  if (!secret) throw new Error("QUEUE_IDEMPOTENCY_SECRET is required in production");
  return createHmac("sha256", secret).update(key, "utf8").digest("base64url");
}

export function hashMatches(left: Uint8Array | null | undefined, right: Uint8Array | null | undefined): boolean {
  if (!left || !right || left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function queueTokenMatches(token: string, hash: Uint8Array | Buffer): boolean {
  if (!token || hash.byteLength !== 32) return false;
  const actual = hashQueueToken(token);
  return timingSafeEqual(Buffer.from(actual), Buffer.from(hash));
}

export function readQueueToken(request: Request): string {
  return request.headers.get("x-queue-token")?.trim() ?? "";
}
