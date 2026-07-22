import type { QueueEntry, QueueRecalculationInput, QueueRecalculationResult, QueueSlot } from "./types";

const MINUTE = 60_000;

/** A tiny deterministic min-heap. Ties are resolved by insertion order. */
class MinHeap<T> {
  private readonly values: T[] = [];

  constructor(private readonly compare: (a: T, b: T) => number) {}

  get size() { return this.values.length; }

  push(value: T) {
    this.values.push(value);
    let i = this.values.length - 1;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.compare(this.values[parent], value) <= 0) break;
      this.values[i] = this.values[parent];
      i = parent;
    }
    this.values[i] = value;
  }

  pop(): T | undefined {
    if (!this.values.length) return undefined;
    const first = this.values[0];
    const last = this.values.pop()!;
    if (this.values.length) {
      let i = 0;
      while (true) {
        const left = i * 2 + 1;
        if (left >= this.values.length) break;
        const right = left + 1;
        let child = left;
        if (right < this.values.length && this.compare(this.values[right], this.values[left]) < 0) child = right;
        if (this.compare(this.values[child], last) >= 0) break;
        this.values[i] = this.values[child];
        i = child;
      }
      this.values[i] = last;
    }
    return first;
  }
}

function copyDate(value: Date | null | undefined): Date | null {
  return value ? new Date(value.getTime()) : null;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE);
}

function startOfSlot(slot: QueueSlot, now: Date): Date {
  // A slot with no known time is immediately usable. Unknown occupied slots
  // are initialized by join when the user confirms that the site is full.
  return slot.estimatedAvailableAt && slot.estimatedAvailableAt > now
    ? new Date(slot.estimatedAvailableAt)
    : new Date(now);
}

function fifo(a: QueueEntry, b: QueueEntry): number {
  const joined = a.joinedAt.getTime() - b.joinedAt.getTime();
  return joined || a.queueOrder - b.queueOrder;
}

/**
 * Recompute FIFO estimates using a min-heap of next slot availability.
 * The function never mutates its inputs and is safe to call repeatedly.
 * Waiting entries use the facility fallback until they provide a duration.
 */
export function recalculateQueue(input: QueueRecalculationInput): QueueRecalculationResult {
  const fallbackMinutes = input.fallbackMinutes ?? 45;
  if (!Number.isInteger(fallbackMinutes) || fallbackMinutes < 5 || fallbackMinutes > 120) {
    throw new RangeError("fallbackMinutes must be an integer from 5 to 120");
  }
  const now = new Date(input.now);
  const slots = input.slots.map((slot) => ({ ...slot, estimatedAvailableAt: copyDate(slot.estimatedAvailableAt) }));
  const entries = input.entries.map((entry) => ({
    ...entry,
    joinedAt: new Date(entry.joinedAt),
    estimatedStartAt: copyDate(entry.estimatedStartAt),
    calledAt: copyDate(entry.calledAt),
    callExpiresAt: copyDate(entry.callExpiresAt),
    chargingStartedAt: copyDate(entry.chargingStartedAt),
    durationConfirmedAt: copyDate(entry.durationConfirmedAt),
    expectedFinishAt: copyDate(entry.expectedFinishAt),
    finishConfirmationExpiresAt: copyDate(entry.finishConfirmationExpiresAt),
  }));

  // Existing active users are the source of truth for occupied times.
  const active = new Set(entries.filter((entry) => entry.status === "called" || entry.status === "charging").map((entry) => entry.assignedSlotId));
  const heap = new MinHeap<{ at: Date; slotIndex: number; seq: number }>((a, b) =>
    a.at.getTime() - b.at.getTime() || a.seq - b.seq,
  );
  let sequence = 0;
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const assigned = entries.find((entry) => entry.assignedSlotId === slot.id && (entry.status === "called" || entry.status === "charging"));
    let at = startOfSlot(slot, now);
    if (assigned?.status === "charging" && assigned.expectedFinishAt) at = new Date(assigned.expectedFinishAt);
    else if (assigned?.status === "called") at = addMinutes(now, fallbackMinutes);
    heap.push({ at, slotIndex: i, seq: sequence++ });
  }

  const pending = entries.filter((entry) => entry.status === "waiting" || entry.status === "notified").sort(fifo);
  let earliest: Date | null = null;
  for (const entry of pending) {
    const next = heap.pop();
    if (!next) {
      entry.estimatedStartAt = null;
      entry.assignedSlotId = null;
      entry.estimateConfidence = "unknown";
      continue;
    }
    entry.estimatedStartAt = new Date(next.at);
    entry.assignedSlotId = slots[next.slotIndex].id;
    entry.estimateConfidence = "provisional";
    if (!earliest || next.at < earliest) earliest = new Date(next.at);
    heap.push({ at: addMinutes(next.at, fallbackMinutes), slotIndex: next.slotIndex, seq: sequence++ });
  }

  // Call every slot that is available now. This is intentionally done after
  // assigning estimates so simultaneous availability is handled FIFO.
  if (input.assignCalled !== false) {
    const availableSlots = slots
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => (slot.status === "available" || slot.status === "unknown") && !active.has(slot.id)
        && (!slot.estimatedAvailableAt || slot.estimatedAvailableAt.getTime() <= now.getTime()));
    const toCall = pending.filter((entry) => entry.status === "waiting" || entry.status === "notified").slice(0, availableSlots.length);
    for (let i = 0; i < toCall.length; i += 1) {
      const entry = toCall[i];
      const { slot } = availableSlots[i];
      entry.status = "called";
      entry.assignedSlotId = slot.id;
      entry.calledAt = new Date(now);
      entry.callExpiresAt = addMinutes(now, 5);
      entry.estimatedStartAt = new Date(now);
      entry.estimateConfidence = "confirmed";
      slot.status = "called";
      slot.activeEntryId = entry.id;
      slot.estimatedAvailableAt = addMinutes(now, fallbackMinutes);
    }
  }

  const remaining = entries.filter((entry) => entry.status === "waiting" || entry.status === "notified");
  const firstRemaining = remaining.map((entry) => entry.estimatedStartAt).filter((value): value is Date => !!value).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  return { slots, entries, waitingCount: remaining.length, earliestStartAt: firstRemaining };
}

export function minutesUntil(startAt: Date | null, now: Date): number | null {
  if (!startAt) return null;
  return Math.max(0, Math.ceil((startAt.getTime() - now.getTime()) / MINUTE));
}

export function roundWaitMinutes(minutes: number | null): number | null {
  if (minutes === null) return null;
  return Math.ceil(Math.max(0, minutes) / 5) * 5;
}

export function isCallExpired(entry: Pick<QueueEntry, "status" | "callExpiresAt">, now: Date): boolean {
  return entry.status === "called" && !!entry.callExpiresAt && entry.callExpiresAt.getTime() <= now.getTime();
}

export function isFinishConfirmationDue(entry: Pick<QueueEntry, "status" | "finishConfirmationExpiresAt">, now: Date): boolean {
  return entry.status === "charging" && !!entry.finishConfirmationExpiresAt && entry.finishConfirmationExpiresAt.getTime() <= now.getTime();
}

export function isFinishNoticeDue(entry: Pick<QueueEntry, "status" | "expectedFinishAt" | "chargeEndPushSentAt">, now: Date): boolean {
  return entry.status === "charging" && !entry.chargeEndPushSentAt && !!entry.expectedFinishAt && entry.expectedFinishAt.getTime() - now.getTime() <= 3 * MINUTE;
}

export function isFiveMinuteNoticeDue(entry: Pick<QueueEntry, "status" | "estimatedStartAt" | "fiveMinPushSentAt">, now: Date): boolean {
  return (entry.status === "waiting" || entry.status === "notified") && !entry.fiveMinPushSentAt && !!entry.estimatedStartAt && entry.estimatedStartAt.getTime() - now.getTime() <= 5 * MINUTE;
}

export function expectedFinishAt(startedAt: Date, minutes: number): Date {
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 120) throw new RangeError("duration must be an integer from 5 to 120");
  return addMinutes(startedAt, minutes);
}

export function extensionWindowOpen(expected: Date, now: Date): boolean {
  const delta = expected.getTime() - now.getTime();
  return delta <= 3 * MINUTE && delta >= -5 * MINUTE;
}

export const QUEUE_MINUTES = { min: 5, max: 120, fallback: 45, callGrace: 5, finishGrace: 5, extensionLead: 3 } as const;

// Concise aliases make the pure service convenient to consume from tests and
// other server modules without introducing a second implementation.
export const recalculate = recalculateQueue;
export default recalculateQueue;
