/** Queue domain types.  These deliberately mirror the persistence model but
 * contain no database or HTTP concerns. */

export type QueueStatus = "waiting" | "notified" | "called" | "charging";
export type SlotStatus = "available" | "occupied" | "called" | "unknown";
export type EstimateConfidence = "confirmed" | "provisional" | "unknown";

export interface QueueSlot {
  id: string;
  status: SlotStatus;
  estimatedAvailableAt: Date | null;
  activeEntryId?: string | null;
}

export interface QueueEntry {
  id: string;
  queueOrder: number;
  joinedAt: Date;
  status: QueueStatus;
  estimatedStartAt: Date | null;
  estimateConfidence: EstimateConfidence;
  assignedSlotId: string | null;
  calledAt: Date | null;
  callExpiresAt: Date | null;
  chargingStartedAt: Date | null;
  initialChargeMinutes: number | null;
  durationConfirmedAt: Date | null;
  expectedFinishAt: Date | null;
  finishConfirmationExpiresAt: Date | null;
  pushOptIn?: boolean;
  pushSubscriptionId?: string | null;
  fiveMinPushSentAt?: Date | null;
  calledPushSentAt?: Date | null;
  chargeEndPushSentAt?: Date | null;
  /** Hashes used only for active-request deduplication; deleted with the entry. */
  joinIdempotencyKeyHash?: Uint8Array | null;
  joinIdempotencyFingerprintHash?: Uint8Array | null;
  lastMutationKeyHash?: Uint8Array | null;
  lastMutationFingerprintHash?: Uint8Array | null;
  lastMutationAt?: Date | null;
  nickname?: string;
  chargingSiteId?: string;
}

export interface QueueRecalculationInput {
  now: Date;
  slots: readonly QueueSlot[];
  entries: readonly QueueEntry[];
  /** Facility standard duration. The specification uses 45 minutes. */
  fallbackMinutes?: number;
  /** If true, free slots are promoted to called entries in this pass. */
  assignCalled?: boolean;
}

export interface QueueRecalculationResult {
  slots: QueueSlot[];
  entries: QueueEntry[];
  /** Number of waiting/notified entries (called and charging are not waiting). */
  waitingCount: number;
  /** Earliest start among waiting/notified entries, or null. */
  earliestStartAt: Date | null;
}
