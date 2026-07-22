import { extensionWindowOpen, expectedFinishAt, QUEUE_MINUTES } from "./recalculate";
import type { QueueEntry } from "./types";

export class QueueDomainError extends Error {
  constructor(public readonly code: string, message = code) { super(message); }
}

export function validateDuration(value: unknown): number {
  if (value === undefined || value === null || value === "") throw new QueueDomainError("DURATION_REQUIRED");
  if (typeof value !== "number" && typeof value !== "string") throw new QueueDomainError("DURATION_NOT_INTEGER");
  const minutes = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(minutes)) throw new QueueDomainError("DURATION_NOT_INTEGER");
  if (minutes < QUEUE_MINUTES.min || minutes > QUEUE_MINUTES.max) throw new QueueDomainError("DURATION_OUT_OF_RANGE");
  return minutes;
}

export function startCharging(entry: QueueEntry, now: Date, fallbackMinutes = QUEUE_MINUTES.fallback): QueueEntry {
  if (entry.status !== "called") throw new QueueDomainError("START_NOT_AVAILABLE");
  if (!entry.callExpiresAt || entry.callExpiresAt.getTime() <= now.getTime()) throw new QueueDomainError("CALL_EXPIRED");
  const started = new Date(now);
  const finish = expectedFinishAt(started, fallbackMinutes);
  return { ...entry, status: "charging", chargingStartedAt: started, expectedFinishAt: finish, finishConfirmationExpiresAt: expectedFinishAt(finish, QUEUE_MINUTES.finishGrace) };
}

export function confirmInitialDuration(entry: QueueEntry, value: unknown, now: Date): QueueEntry {
  if (entry.status !== "charging" || !entry.chargingStartedAt) throw new QueueDomainError("INVALID_QUEUE_STATE");
  if (entry.initialChargeMinutes !== null || entry.durationConfirmedAt !== null) throw new QueueDomainError("DURATION_ALREADY_CONFIRMED");
  const minutes = validateDuration(value);
  const finish = expectedFinishAt(entry.chargingStartedAt, minutes);
  return { ...entry, initialChargeMinutes: minutes, durationConfirmedAt: new Date(now), expectedFinishAt: finish, finishConfirmationExpiresAt: expectedFinishAt(finish, QUEUE_MINUTES.finishGrace) };
}

export function extendCharging(entry: QueueEntry, value: unknown, now: Date): QueueEntry {
  if (entry.status !== "charging" || !entry.expectedFinishAt) throw new QueueDomainError("EXTENSION_UNAVAILABLE");
  if (!extensionWindowOpen(entry.expectedFinishAt, now)) throw new QueueDomainError("EXTENSION_UNAVAILABLE");
  const minutes = validateDuration(value);
  const finish = expectedFinishAt(entry.expectedFinishAt, minutes);
  return { ...entry, expectedFinishAt: finish, finishConfirmationExpiresAt: expectedFinishAt(finish, QUEUE_MINUTES.finishGrace) };
}

export function canComplete(entry: QueueEntry): boolean {
  return entry.status === "charging";
}
