import { recalculateQueue, minutesUntil, roundWaitMinutes, isCallExpired, isFinishConfirmationDue, isFinishNoticeDue, isFiveMinuteNoticeDue, QUEUE_MINUTES } from "../queue/recalculate";
import { canComplete, confirmInitialDuration, extendCharging, skipWaitAndStartCharging, startCharging, QueueDomainError } from "../queue/state";
import type { QueueEntry } from "../queue/types";
import { ApiError } from "./errors";
import { getQueueStore, type QueueEntryRecord, type QueueTransaction, type SiteRecord } from "./db";
import { createIdempotentQueueToken, createQueueToken, hashMatches, hashQueueToken, hashRequestFingerprint, hashRequestKey, queueTokenMatches } from "./token";
import { sendQueuePush, type PushMessage } from "./push";
import { broadcastQueueChanged } from "./realtime";

// QueueSite is kept as an alias for consumers that describe a facility.
export interface QueueSnapshot {
  entryId: string;
  status: QueueEntry["status"];
  position: number | null;
  aheadCount: number | null;
  estimatedStartAt: string | null;
  estimatedWaitMinutes: number | null;
  estimateConfidence: QueueEntry["estimateConfidence"];
  calledAt: string | null;
  callExpiresAt: string | null;
  chargingStartedAt: string | null;
  expectedFinishAt: string | null;
  finishConfirmationExpiresAt: string | null;
  canStart: boolean;
  canSkipStart: boolean;
  canSetDuration: boolean;
  canExtend: boolean;
  canComplete: boolean;
  queueVersion: number;
}

export interface SiteSummary {
  siteId: string;
  queueEnabled: boolean;
  waitingCount: number;
  estimatedWaitMinutes: number;
  queueVersion: number;
}

function nowOr(value?: Date): Date { return value ? new Date(value) : new Date(); }
function iso(value: Date | null | undefined): string | null { return value ? new Date(value).toISOString() : null; }
function domainError(error: unknown): never {
  if (error instanceof QueueDomainError) throw new ApiError(error.code as never);
  throw error;
}

function applyRecalculation(tx: QueueTransaction, now: Date): ReturnType<typeof recalculateQueue> {
  const result = recalculateQueue({ now, slots: tx.slots, entries: tx.entries, fallbackMinutes: tx.site.defaultChargeMinutes, assignCalled: true });
  tx.slots.splice(0, tx.slots.length, ...result.slots);
  tx.entries.splice(0, tx.entries.length, ...result.entries as QueueEntryRecord[]);
  return result;
}

function sortFifo(entries: readonly QueueEntryRecord[]): QueueEntryRecord[] {
  return entries.filter((entry) => entry.status === "waiting" || entry.status === "notified").sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || a.queueOrder - b.queueOrder);
}

function snapshot(tx: QueueTransaction, entry: QueueEntryRecord, now: Date): QueueSnapshot {
  const pending = sortFifo(tx.entries);
  const index = pending.findIndex((candidate) => candidate.id === entry.id);
  const ahead = index >= 0 ? index : null;
  return {
    entryId: entry.id,
    status: entry.status,
    position: index >= 0 ? index + 1 : null,
    aheadCount: ahead,
    estimatedStartAt: iso(entry.estimatedStartAt),
    estimatedWaitMinutes: roundWaitMinutes(minutesUntil(entry.estimatedStartAt, now)),
    estimateConfidence: entry.estimateConfidence,
    calledAt: iso(entry.calledAt),
    callExpiresAt: iso(entry.callExpiresAt),
    chargingStartedAt: iso(entry.chargingStartedAt),
    expectedFinishAt: iso(entry.expectedFinishAt),
    finishConfirmationExpiresAt: iso(entry.finishConfirmationExpiresAt),
    canStart: entry.status === "called",
    canSkipStart: entry.status === "waiting" || entry.status === "notified",
    canSetDuration: entry.status === "charging" && entry.initialChargeMinutes === null,
    canExtend: entry.status === "charging" && !!entry.expectedFinishAt && entry.expectedFinishAt.getTime() - now.getTime() <= 3 * 60_000 && entry.expectedFinishAt.getTime() - now.getTime() >= -5 * 60_000,
    canComplete: canComplete(entry),
    queueVersion: tx.site.queueVersion,
  };
}

function makeEntry(siteId: string, nickname: string, token: string, now: Date, queueOrder: number, joinIdempotencyKeyHash: Uint8Array | null, joinIdempotencyFingerprintHash: Uint8Array | null): QueueEntryRecord {
  return {
    id: crypto.randomUUID(), chargingSiteId: siteId, queueOrder, managementTokenHash: hashQueueToken(token), nickname,
    joinedAt: new Date(now), status: "waiting", estimatedStartAt: null, estimateConfidence: "unknown", assignedSlotId: null,
    calledAt: null, callExpiresAt: null, chargingStartedAt: null, initialChargeMinutes: null, durationConfirmedAt: null,
    expectedFinishAt: null, finishConfirmationExpiresAt: null, pushOptIn: false, pushSubscriptionId: null,
    fiveMinPushSentAt: null, calledPushSentAt: null, chargeEndPushSentAt: null,
    joinIdempotencyKeyHash, joinIdempotencyFingerprintHash,
    lastMutationKeyHash: null, lastMutationFingerprintHash: null, lastMutationAt: null,
  };
}

export function validateNickname(value: unknown): string {
  if (typeof value !== "string") throw new ApiError("NICKNAME_INVALID");
  const normalized = value.normalize("NFKC").trim();
  const chars = Array.from(normalized);
  if (!chars.length || chars.length > 30 || /[\u0000-\u001f\u007f]/u.test(normalized)) throw new ApiError("NICKNAME_INVALID");
  return normalized;
}

export async function listSites(): Promise<SiteRecord[]> { return getQueueStore().listSites(); }

export async function getSiteSummary(siteId: string, now = new Date()): Promise<SiteSummary> {
  return getQueueStore().transaction(siteId, async (tx) => {
    // A read must never call or delete an entry. Recalculate estimates in a
    // non-mutating mode so elapsed time and active-slot changes are reflected
    // even when no write has occurred since the last queue operation.
    const estimate = recalculateQueue({
      now,
      slots: tx.slots,
      entries: tx.entries,
      fallbackMinutes: tx.site.defaultChargeMinutes,
      assignCalled: false,
    });
    return {
      siteId: tx.site.id,
      queueEnabled: tx.site.queueEnabled,
      waitingCount: estimate.waitingCount,
      estimatedWaitMinutes: roundWaitMinutes(minutesUntil(estimate.earliestStartAt, now)) ?? 0,
      queueVersion: tx.site.queueVersion,
    };
  }, { lock: false });
}

export async function joinQueue(input: { siteId: string; nickname: unknown; siteIsFull: unknown; acceptedTerms: unknown; termsVersion: unknown; turnstileVerified?: boolean; idempotencyKey?: string | null; now?: Date }): Promise<{ entryId: string; token: string; snapshot: QueueSnapshot; siteId: string }> {
  if (input.acceptedTerms !== true) throw new ApiError("TERMS_NOT_ACCEPTED");
  if (typeof input.termsVersion !== "string" || input.termsVersion !== (process.env.QUEUE_TERMS_VERSION ?? "2026-07-22")) throw new ApiError("TERMS_VERSION_OUTDATED");
  const nickname = validateNickname(input.nickname);
  const now = nowOr(input.now);
  const candidateRequestKey = input.idempotencyKey?.trim() || null;
  const requestKey = candidateRequestKey && candidateRequestKey.length <= 256 ? candidateRequestKey : null;
  const fingerprintHash = hashRequestFingerprint({ siteId: input.siteId, nickname, siteIsFull: input.siteIsFull, acceptedTerms: input.acceptedTerms, termsVersion: input.termsVersion });
  const keyHash = requestKey ? hashRequestKey(requestKey) : null;
  const token = requestKey ? createIdempotentQueueToken(requestKey) : createQueueToken();
  const result = await getQueueStore().transaction(input.siteId, async (tx) => {
    if (keyHash) {
      const existing = tx.entries.find((candidate) => candidate.joinIdempotencyKeyHash && hashMatches(candidate.joinIdempotencyKeyHash, keyHash));
      if (existing) {
        if (!hashMatches(existing.joinIdempotencyFingerprintHash, fingerprintHash)) throw new ApiError("IDEMPOTENCY_KEY_REUSED");
        return { entryId: existing.id, token, snapshot: snapshot(tx, existing, now), siteId: tx.site.id, queueVersion: tx.site.queueVersion, changed: false };
      }
    }
    if (input.turnstileVerified === false) throw new ApiError("CAPTCHA_FAILED");
    if (!tx.site.queueEnabled) throw new ApiError("FACILITY_QUEUE_DISABLED");
    const hadWaiting = tx.entries.some((entry) => entry.status === "waiting" || entry.status === "notified" || entry.status === "called");
    if (!hadWaiting && input.siteIsFull !== true) throw new ApiError("FULL_CONFIRMATION_REQUIRED", 409, false);
    if (!hadWaiting && input.siteIsFull === true) {
      for (const slot of tx.slots) {
        if (slot.status === "unknown" || slot.status === "available") {
          slot.status = "occupied";
          slot.estimatedAvailableAt = new Date(now.getTime() + tx.site.defaultChargeMinutes * 60_000);
          slot.activeEntryId = null;
        }
      }
    }
    const order = Math.max(0, ...tx.entries.map((entry) => entry.queueOrder)) + 1;
    const entry = makeEntry(tx.site.id, nickname, token, now, order, keyHash, fingerprintHash);
    await tx.insertEntry(entry);
    if (!tx.site.queueStartedAt) tx.site.queueStartedAt = new Date(now);
    applyRecalculation(tx, now);
    const saved = tx.entries.find((candidate) => candidate.id === entry.id)!;
    tx.bumpVersion();
    return { entryId: entry.id, token, snapshot: snapshot(tx, saved, now), siteId: tx.site.id, queueVersion: tx.site.queueVersion, changed: true };
  });
  if (result.changed) await broadcastQueueChanged({ siteId: result.siteId, queueVersion: result.queueVersion });
  return result;
}

export async function getMyQueue(entryId: string, token: string, now = new Date()): Promise<QueueSnapshot> {
  if (!entryId || !token) throw new ApiError("MANAGEMENT_TOKEN_INVALID");
  const store = getQueueStore();
  const located = await store.lookupEntry(entryId);
  if (!located) throw new ApiError("ENTRY_NOT_FOUND");
  if (!queueTokenMatches(token, located.managementTokenHash)) throw new ApiError("MANAGEMENT_TOKEN_INVALID");
  return store.transaction(located.siteId, async (tx) => {
    const entry = tx.entries.find((candidate) => candidate.id === entryId);
    if (!entry) throw new ApiError("ENTRY_NOT_FOUND");
    if (!queueTokenMatches(token, entry.managementTokenHash)) throw new ApiError("MANAGEMENT_TOKEN_INVALID");
    return snapshot(tx, entry, now);
  }, { lock: false });
}

type MutationRequest = { key?: string | null; fingerprint?: unknown };
const MUTATION_DEDUPE_WINDOW = 10 * 60_000;
async function mutateEntry(entryId: string, token: string, operation: (tx: QueueTransaction, entry: QueueEntryRecord, now: Date) => void | Promise<void>, now = new Date(), request: MutationRequest = {}): Promise<{ snapshot: QueueSnapshot; siteId: string; queueVersion: number }> {
  const store = getQueueStore();
  const located = await store.lookupEntry(entryId);
  if (!located) throw new ApiError("ENTRY_NOT_FOUND");
  if (!queueTokenMatches(token, located.managementTokenHash)) throw new ApiError("MANAGEMENT_TOKEN_INVALID");
  const result = await store.transaction(located.siteId, async (tx) => {
    const entry = tx.entries.find((candidate) => candidate.id === entryId);
    if (!entry) throw new ApiError("ENTRY_NOT_FOUND");
    if (!queueTokenMatches(token, entry.managementTokenHash)) throw new ApiError("MANAGEMENT_TOKEN_INVALID");
    const candidateKey = request.key?.trim() || null;
    const key = candidateKey && candidateKey.length <= 256 ? candidateKey : null;
    const keyHash = key ? hashRequestKey(key) : null;
    const fingerprintHash = key ? hashRequestFingerprint(request.fingerprint) : null;
    const alreadyApplied = !!(keyHash && fingerprintHash && entry.lastMutationKeyHash && entry.lastMutationFingerprintHash && entry.lastMutationAt && now.getTime() - entry.lastMutationAt.getTime() <= MUTATION_DEDUPE_WINDOW && hashMatches(entry.lastMutationKeyHash, keyHash));
    if (alreadyApplied && !hashMatches(entry.lastMutationFingerprintHash, fingerprintHash)) throw new ApiError("IDEMPOTENCY_KEY_REUSED");
    if (!alreadyApplied) {
      if (keyHash && fingerprintHash) { entry.lastMutationKeyHash = keyHash; entry.lastMutationFingerprintHash = fingerprintHash; entry.lastMutationAt = new Date(now); tx.markChanged(); }
      await operation(tx, entry, now);
    }
    const fresh = tx.entries.find((candidate) => candidate.id === entryId);
    const queueVersion = tx.site.queueVersion;
    return { snapshot: fresh ? snapshot(tx, fresh, now) : null, siteId: tx.site.id, queueVersion, changed: !alreadyApplied };
  });
  if (result.changed) await broadcastQueueChanged({ siteId: result.siteId, queueVersion: result.queueVersion });
  if (result.snapshot) {
    return result as { snapshot: QueueSnapshot; siteId: string; queueVersion: number };
  }
  return { snapshot: { entryId, status: "waiting", position: null, aheadCount: null, estimatedStartAt: null, estimatedWaitMinutes: null, estimateConfidence: "unknown", calledAt: null, callExpiresAt: null, chargingStartedAt: null, expectedFinishAt: null, finishConfirmationExpiresAt: null, canStart: false, canSkipStart: false, canSetDuration: false, canExtend: false, canComplete: false, queueVersion: result.queueVersion }, siteId: result.siteId, queueVersion: result.queueVersion };
}

export async function cancelQueue(entryId: string, token: string, now = new Date(), request: MutationRequest = {}) {
  return mutateEntry(entryId, token, async (tx, entry) => {
    if (entry.assignedSlotId) {
      const slot = tx.slots.find((candidate) => candidate.id === entry.assignedSlotId);
      if (slot?.activeEntryId === entry.id) { slot.activeEntryId = null; slot.status = "available"; slot.estimatedAvailableAt = new Date(now); }
    }
    tx.deleteEntry(entry.id);
    applyRecalculation(tx, now);
    if (!tx.entries.some((candidate) => ["waiting", "notified", "called", "charging"].includes(candidate.status))) tx.site.queueStartedAt = null;
    tx.bumpVersion();
  }, now, request);
}

export async function startQueue(entryId: string, token: string, now = new Date(), request: MutationRequest = {}) {
  return mutateEntry(entryId, token, async (tx, entry) => {
    let updated: QueueEntryRecord;
    try { updated = startCharging(entry, now, QUEUE_MINUTES.fallback) as QueueEntryRecord; } catch (error) { return domainError(error); }
    Object.assign(entry, updated);
    const slot = tx.slots.find((candidate) => candidate.id === entry.assignedSlotId);
    if (slot) { slot.status = "occupied"; slot.activeEntryId = entry.id; slot.estimatedAvailableAt = new Date(entry.expectedFinishAt!); }
    applyRecalculation(tx, now);
    tx.bumpVersion();
  }, now, request);
}

function selectPhysicalOpenSlot(tx: QueueTransaction, entry: QueueEntryRecord) {
  const activeSlotIds = new Set(tx.entries
    .filter((candidate) => candidate.status === "called" || candidate.status === "charging")
    .map((candidate) => candidate.assignedSlotId)
    .filter((slotId): slotId is string => !!slotId));
  const statusRank = { available: 0, unknown: 1, occupied: 2, called: 3 } as const;
  return tx.slots
    .filter((slot) => !activeSlotIds.has(slot.id) && !slot.activeEntryId)
    .sort((left, right) => {
      const assigned = Number(right.id === entry.assignedSlotId) - Number(left.id === entry.assignedSlotId);
      if (assigned) return assigned;
      const status = statusRank[left.status] - statusRank[right.status];
      if (status) return status;
      return (left.estimatedAvailableAt?.getTime() ?? 0) - (right.estimatedAvailableAt?.getTime() ?? 0) || left.id.localeCompare(right.id);
    })[0] ?? null;
}

/** Confirmed physical vacancy: bypass the virtual wait and immediately occupy
 * one non-active stall, then recalculate every remaining estimate. */
export async function skipWaitAndStartQueue(entryId: string, token: string, now = new Date(), request: MutationRequest = {}) {
  return mutateEntry(entryId, token, async (tx, entry) => {
    const slot = selectPhysicalOpenSlot(tx, entry);
    if (!slot) throw new ApiError("SKIP_START_NOT_AVAILABLE");
    let updated: QueueEntryRecord;
    try { updated = skipWaitAndStartCharging({ ...entry, assignedSlotId: slot.id }, now, QUEUE_MINUTES.fallback) as QueueEntryRecord; } catch (error) { return domainError(error); }
    Object.assign(entry, updated);
    slot.status = "occupied";
    slot.activeEntryId = entry.id;
    slot.estimatedAvailableAt = new Date(entry.expectedFinishAt!);
    applyRecalculation(tx, now);
    tx.bumpVersion();
  }, now, request);
}

export async function setDuration(entryId: string, token: string, minutes: unknown, now = new Date(), request: MutationRequest = {}) {
  return mutateEntry(entryId, token, async (tx, entry) => {
    let updated: QueueEntryRecord;
    try { updated = confirmInitialDuration(entry, minutes, now) as QueueEntryRecord; } catch (error) { return domainError(error); }
    Object.assign(entry, updated);
    const slot = tx.slots.find((candidate) => candidate.id === entry.assignedSlotId);
    if (slot) slot.estimatedAvailableAt = new Date(entry.expectedFinishAt!);
    applyRecalculation(tx, now);
    tx.bumpVersion();
  }, now, request);
}

export async function extendQueue(entryId: string, token: string, minutes: unknown, now = new Date(), request: MutationRequest = {}) {
  return mutateEntry(entryId, token, async (tx, entry) => {
    let updated: QueueEntryRecord;
    try { updated = extendCharging(entry, minutes, now) as QueueEntryRecord; } catch (error) { return domainError(error); }
    Object.assign(entry, updated);
    const slot = tx.slots.find((candidate) => candidate.id === entry.assignedSlotId);
    if (slot) slot.estimatedAvailableAt = new Date(entry.expectedFinishAt!);
    applyRecalculation(tx, now);
    tx.bumpVersion();
  }, now, request);
}

export async function completeQueue(entryId: string, token: string, now = new Date(), request: MutationRequest = {}) {
  return mutateEntry(entryId, token, async (tx, entry) => {
    if (!canComplete(entry)) throw new ApiError("COMPLETE_NOT_AVAILABLE");
    if (entry.assignedSlotId) {
      const slot = tx.slots.find((candidate) => candidate.id === entry.assignedSlotId);
      if (slot) { slot.status = "available"; slot.activeEntryId = null; slot.estimatedAvailableAt = new Date(now); }
    }
    tx.deleteEntry(entry.id);
    applyRecalculation(tx, now);
    if (!tx.entries.some((candidate) => ["waiting", "notified", "called", "charging"].includes(candidate.status))) tx.site.queueStartedAt = null;
    tx.bumpVersion();
  }, now, request);
}

export async function registerPushSubscription(entryId: string, token: string, subscriptionId: unknown, now = new Date(), request: MutationRequest = {}) {
  if (typeof subscriptionId !== "string" || subscriptionId.length < 1 || subscriptionId.length > 512) throw new ApiError("PUSH_REGISTRATION_FAILED");
  return mutateEntry(entryId, token, async (tx, entry) => {
    entry.pushOptIn = true; entry.pushSubscriptionId = subscriptionId; tx.markChanged();
  }, now, request);
}

export interface CronResult { sites: number; expired: number; autoCompleted: number; notifications: number; }
type ClaimedPush = PushMessage & { siteId: string; entryId: string; claimedAt: Date };

const CRON_SITE_CONCURRENCY = 4;

async function forEachWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      await operation(values[index]);
    }
  });
  await Promise.all(workers);
}

export async function processQueue(now = new Date()): Promise<CronResult> {
  // Completed, cancelled and expired entries are deleted, so queue_entries is
  // the authoritative and inexpensive list of facilities that need a tick.
  // This avoids opening a transaction for every facility when queues are idle.
  const siteIds = await getQueueStore().listActiveSiteIds();
  const result: CronResult = { sites: siteIds.length, expired: 0, autoCompleted: 0, notifications: 0 };
  const pushes: ClaimedPush[] = [];
  await forEachWithConcurrency(siteIds, CRON_SITE_CONCURRENCY, async (siteId) => {
    await getQueueStore().transaction(siteId, async (tx) => {
      let changed = false;
      for (const entry of [...tx.entries]) {
        if (isCallExpired(entry, now)) {
          if (entry.assignedSlotId) { const slot = tx.slots.find((candidate) => candidate.id === entry.assignedSlotId); if (slot) { slot.status = "available"; slot.activeEntryId = null; slot.estimatedAvailableAt = new Date(now); } }
          tx.deleteEntry(entry.id); result.expired += 1; changed = true; continue;
        }
        if (isFinishConfirmationDue(entry, now)) {
          if (entry.assignedSlotId) { const slot = tx.slots.find((candidate) => candidate.id === entry.assignedSlotId); if (slot) { slot.status = "available"; slot.activeEntryId = null; slot.estimatedAvailableAt = new Date(now); } }
          tx.deleteEntry(entry.id); result.autoCompleted += 1; changed = true; continue;
        }
        const siteName = tx.site.name;
        const subscriptionId = entry.pushSubscriptionId;
        if (subscriptionId && isFiveMinuteNoticeDue(entry, now)) { entry.fiveMinPushSentAt = new Date(now); entry.status = "notified"; pushes.push({ kind: "five_minute", subscriptionId, siteName, siteId: tx.site.id, entryId: entry.id, claimedAt: new Date(now) }); result.notifications += 1; tx.markChanged(); }
        if (subscriptionId && entry.status === "called" && !entry.calledPushSentAt) { entry.calledPushSentAt = new Date(now); pushes.push({ kind: "called", subscriptionId, siteName, siteId: tx.site.id, entryId: entry.id, claimedAt: new Date(now) }); result.notifications += 1; tx.markChanged(); }
        if (subscriptionId && isFinishNoticeDue(entry, now)) { entry.chargeEndPushSentAt = new Date(now); pushes.push({ kind: "charge_end", subscriptionId, siteName, siteId: tx.site.id, entryId: entry.id, claimedAt: new Date(now) }); result.notifications += 1; tx.markChanged(); }
      }
      if (changed) { applyRecalculation(tx, now); tx.bumpVersion(); }
      if (changed && !tx.entries.some((entry) => entry.status === "waiting" || entry.status === "notified" || entry.status === "called")) tx.site.queueStartedAt = null;
    });
  });
  await Promise.all(pushes.map(async (push) => {
    let delivered = false;
    try { delivered = await sendQueuePush(push); } catch { delivered = false; }
    if (delivered) return;
    // Release a failed claim so the next Cron can retry. The marker is
    // cleared only when it still belongs to this attempt; a later successful
    // attempt or a completed entry is never rolled back.
    await getQueueStore().transaction(push.siteId, async (tx) => {
      const entry = tx.entries.find((candidate) => candidate.id === push.entryId);
      if (!entry) return;
      const field = push.kind === "five_minute" ? "fiveMinPushSentAt" : push.kind === "called" ? "calledPushSentAt" : "chargeEndPushSentAt";
      if (entry[field]?.getTime() === push.claimedAt.getTime()) { entry[field] = null; tx.markChanged(); }
    });
  }));
  return result;
}
