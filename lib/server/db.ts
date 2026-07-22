import { requireDatabaseUrl } from "./config";
import { ApiError } from "./errors";
import type { QueueEntry, QueueSlot, SlotStatus } from "../queue/types";
import { Pool, type QueryResultRow } from "pg";

export interface SiteRecord {
  id: string;
  name: string;
  address: string;
  prefecture?: string | null;
  municipality?: string | null;
  normalizedSearchText?: string;
  stallCount: number;
  defaultChargeMinutes: number;
  queueEnabled: boolean;
  queueVersion: number;
  queueStartedAt?: Date | null;
}

export interface QueueEntryRecord extends QueueEntry {
  chargingSiteId: string;
  managementTokenHash: Uint8Array;
  nickname: string;
}

export interface QueueTransaction {
  readonly site: SiteRecord;
  readonly slots: QueueSlot[];
  readonly entries: QueueEntryRecord[];
  insertEntry(entry: QueueEntryRecord): void | Promise<void>;
  deleteEntry(entryId: string): void;
  /** Mark non-calculation fields (for example push claim timestamps) dirty. */
  markChanged(): void;
  bumpVersion(): number;
  commit(): Promise<void>;
}

export interface QueueStore {
  listSites(): Promise<SiteRecord[]>;
  lookupEntry(entryId: string): Promise<{ siteId: string; managementTokenHash: Uint8Array } | null>;
  transaction<T>(siteId: string, fn: (tx: QueueTransaction) => Promise<T> | T, options?: { lock?: boolean }): Promise<T>;
}

let injectedStore: QueueStore | undefined;
let productionStore: QueueStore | undefined;
export function setQueueStoreForTests(store: QueueStore | undefined) { injectedStore = store; }

/**
 * Production DB access is supplied by the deployment adapter. The interface
 * makes all queue calculations testable without network or Supabase.
 * `SUPABASE_DATABASE_URL` is intentionally read only on the server boundary.
 */
export function getQueueStore(): QueueStore {
  if (injectedStore) return injectedStore;
  if (!productionStore) productionStore = new PostgresQueueStore(requireDatabaseUrl());
  return productionStore;
}

/** PostgreSQL adapter. Every transaction locks the facility row, slots, and
 * active entries before TypeScript queue calculations are applied. */
export class PostgresQueueStore implements QueueStore {
  private readonly pool: Pool;
  constructor(url = requireDatabaseUrl()) {
    this.pool = new Pool({ connectionString: url, max: 8, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 });
  }

  async listSites(): Promise<SiteRecord[]> {
    try {
      const result = await this.pool.query<SiteRow>(`select id, name, address, prefecture, municipality,
        normalized_search_text, stall_count, default_charge_minutes, queue_enabled, queue_version, queue_started_at
        from public.charging_sites order by name`);
      return result.rows.map(siteFromRow);
    } catch {
      throw new ApiError("SERVER_TEMPORARY_ERROR");
    }
  }

  async lookupEntry(entryId: string): Promise<{ siteId: string; managementTokenHash: Uint8Array } | null> {
    try {
      const result = await this.pool.query<{ charging_site_id: string; management_token_hash: Buffer }>(
        "select charging_site_id, management_token_hash from public.queue_entries where id = $1",
        [entryId],
      );
      const row = result.rows[0];
      return row ? { siteId: row.charging_site_id, managementTokenHash: new Uint8Array(row.management_token_hash) } : null;
    } catch {
      throw new ApiError("SERVER_TEMPORARY_ERROR");
    }
  }

  async transaction<T>(siteId: string, fn: (tx: QueueTransaction) => Promise<T> | T, options: { lock?: boolean } = {}): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const lock = options.lock !== false;
      const siteResult = await client.query<SiteRow>(`select id, name, address, prefecture, municipality,
        normalized_search_text, stall_count, default_charge_minutes, queue_enabled, queue_version, queue_started_at
        from public.charging_sites where id = $1${lock ? " for update" : ""}`, [siteId]);
      if (!siteResult.rows[0]) throw new ApiError("FACILITY_NOT_FOUND");
      const site = siteFromRow(siteResult.rows[0]);
      // Lock all slots and queue rows for this facility. The facility lock is
      // the serialization point; these locks also protect FK updates/deletes.
      const [slotResult, entryResult] = await Promise.all([
          client.query<SlotRow>(`select id, status, active_entry_id, estimated_available_at
          from public.site_slots where charging_site_id = $1 order by slot_number${lock ? " for update" : ""}`, [siteId]),
        client.query<EntryRow>(`select * from public.queue_entries where charging_site_id = $1
          order by joined_at, queue_order${lock ? " for update" : ""}`, [siteId]),
      ]);
      const slots = slotResult.rows.map(slotFromRow);
      const entries = entryResult.rows.map(entryFromRow);
      const initialSlotIds = new Set(slots.map((slot) => slot.id));
      let changed = false;
      const tx: QueueTransaction = {
        site,
        slots,
        entries,
        insertEntry: async (entry) => {
          const inserted = await client.query<{ queue_order: string }>(`insert into public.queue_entries (
            id, charging_site_id, management_token_hash, nickname, status, joined_at,
            estimated_start_at, estimate_confidence, assigned_slot_id, called_at, call_expires_at,
            charging_started_at, initial_charge_minutes, duration_confirmed_at, expected_finish_at,
            finish_confirmation_expires_at, push_opt_in, push_subscription_id,
            five_min_push_sent_at, called_push_sent_at, charge_end_push_sent_at,
            join_idempotency_key_hash, join_idempotency_fingerprint_hash,
            last_mutation_key_hash, last_mutation_fingerprint_hash, last_mutation_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
          returning queue_order`, entryParams(entry, siteId));
          entry.queueOrder = Number(inserted.rows[0]?.queue_order ?? entry.queueOrder);
          entries.push(entry);
          changed = true;
        },
        deleteEntry: (entryId) => {
          const index = entries.findIndex((entry) => entry.id === entryId);
          if (index >= 0) { entries.splice(index, 1); changed = true; }
        },
        markChanged: () => { changed = true; },
        bumpVersion: () => { site.queueVersion += 1; changed = true; return site.queueVersion; },
        commit: async () => {
          if (!changed) return;
          const currentIds = entries.map((entry) => entry.id);
          if (currentIds.length) await client.query(`delete from public.queue_entries where charging_site_id = $1 and not (id = any($2::uuid[]))`, [siteId, currentIds]);
          else await client.query(`delete from public.queue_entries where charging_site_id = $1`, [siteId]);
          for (const entry of entries) {
            await client.query(`update public.queue_entries set management_token_hash=$2, nickname=$3, status=$4,
              joined_at=$5, estimated_start_at=$6, estimate_confidence=$7, assigned_slot_id=$8, called_at=$9,
              call_expires_at=$10, charging_started_at=$11, initial_charge_minutes=$12, duration_confirmed_at=$13,
              expected_finish_at=$14, finish_confirmation_expires_at=$15, push_opt_in=$16, push_subscription_id=$17,
              five_min_push_sent_at=$18, called_push_sent_at=$19, charge_end_push_sent_at=$20,
              join_idempotency_key_hash=$21, join_idempotency_fingerprint_hash=$22,
              last_mutation_key_hash=$23, last_mutation_fingerprint_hash=$24, last_mutation_at=$25 where id=$1 and charging_site_id=$26`,
              [entry.id, ...entryParams(entry, siteId).slice(2), siteId]);
          }
          for (const slot of slots) {
            if (!initialSlotIds.has(slot.id)) continue;
            await client.query(`update public.site_slots set status=$2, active_entry_id=$3, estimated_available_at=$4 where id=$1 and charging_site_id=$5`, [slot.id, slot.status, slot.activeEntryId ?? null, slot.estimatedAvailableAt, siteId]);
          }
          await client.query(`update public.charging_sites set queue_version=$2, queue_started_at=$3 where id=$1`, [site.id, site.queueVersion, site.queueStartedAt ?? null]);
        },
      };
      const value = await fn(tx);
      await tx.commit();
      await client.query("commit");
      return value;
    } catch (error) {
      try { await client.query("rollback"); } catch { /* preserve original error */ }
      if (error instanceof ApiError) throw error;
      throw new ApiError("SERVER_TEMPORARY_ERROR");
    } finally {
      client.release();
    }
  }
}

interface SiteRow extends QueryResultRow {
  id: string; name: string; address: string; prefecture: string | null; municipality: string | null;
  normalized_search_text: string; stall_count: number; default_charge_minutes: number; queue_enabled: boolean;
  queue_version: string | number; queue_started_at: Date | null;
}
interface SlotRow extends QueryResultRow { id: string; status: SlotStatus; active_entry_id: string | null; estimated_available_at: Date | null; }
interface EntryRow extends QueryResultRow {
  id: string; charging_site_id: string; queue_order: string | number; management_token_hash: Buffer; nickname: string;
  status: QueueEntry["status"]; joined_at: Date; estimated_start_at: Date | null; estimate_confidence: QueueEntry["estimateConfidence"];
  assigned_slot_id: string | null; called_at: Date | null; call_expires_at: Date | null; charging_started_at: Date | null;
  initial_charge_minutes: number | null; duration_confirmed_at: Date | null; expected_finish_at: Date | null;
  finish_confirmation_expires_at: Date | null; push_opt_in: boolean; push_subscription_id: string | null;
  five_min_push_sent_at: Date | null; called_push_sent_at: Date | null; charge_end_push_sent_at: Date | null;
  join_idempotency_key_hash: Buffer | null; join_idempotency_fingerprint_hash: Buffer | null;
  last_mutation_key_hash: Buffer | null; last_mutation_fingerprint_hash: Buffer | null; last_mutation_at: Date | null;
}
function siteFromRow(row: SiteRow): SiteRecord { return { id: row.id, name: row.name, address: row.address, prefecture: row.prefecture, municipality: row.municipality, normalizedSearchText: row.normalized_search_text, stallCount: Number(row.stall_count), defaultChargeMinutes: Number(row.default_charge_minutes), queueEnabled: row.queue_enabled, queueVersion: Number(row.queue_version), queueStartedAt: row.queue_started_at ? new Date(row.queue_started_at) : null }; }
function slotFromRow(row: SlotRow): QueueSlot { return { id: row.id, status: row.status, activeEntryId: row.active_entry_id, estimatedAvailableAt: row.estimated_available_at ? new Date(row.estimated_available_at) : null }; }
function entryFromRow(row: EntryRow): QueueEntryRecord { return { id: row.id, chargingSiteId: row.charging_site_id, queueOrder: Number(row.queue_order), managementTokenHash: new Uint8Array(row.management_token_hash), nickname: row.nickname, status: row.status, joinedAt: new Date(row.joined_at), estimatedStartAt: row.estimated_start_at ? new Date(row.estimated_start_at) : null, estimateConfidence: row.estimate_confidence, assignedSlotId: row.assigned_slot_id, calledAt: row.called_at ? new Date(row.called_at) : null, callExpiresAt: row.call_expires_at ? new Date(row.call_expires_at) : null, chargingStartedAt: row.charging_started_at ? new Date(row.charging_started_at) : null, initialChargeMinutes: row.initial_charge_minutes, durationConfirmedAt: row.duration_confirmed_at ? new Date(row.duration_confirmed_at) : null, expectedFinishAt: row.expected_finish_at ? new Date(row.expected_finish_at) : null, finishConfirmationExpiresAt: row.finish_confirmation_expires_at ? new Date(row.finish_confirmation_expires_at) : null, pushOptIn: row.push_opt_in, pushSubscriptionId: row.push_subscription_id, fiveMinPushSentAt: row.five_min_push_sent_at ? new Date(row.five_min_push_sent_at) : null, calledPushSentAt: row.called_push_sent_at ? new Date(row.called_push_sent_at) : null, chargeEndPushSentAt: row.charge_end_push_sent_at ? new Date(row.charge_end_push_sent_at) : null, joinIdempotencyKeyHash: row.join_idempotency_key_hash ? new Uint8Array(row.join_idempotency_key_hash) : null, joinIdempotencyFingerprintHash: row.join_idempotency_fingerprint_hash ? new Uint8Array(row.join_idempotency_fingerprint_hash) : null, lastMutationKeyHash: row.last_mutation_key_hash ? new Uint8Array(row.last_mutation_key_hash) : null, lastMutationFingerprintHash: row.last_mutation_fingerprint_hash ? new Uint8Array(row.last_mutation_fingerprint_hash) : null, lastMutationAt: row.last_mutation_at ? new Date(row.last_mutation_at) : null }; }
function entryParams(entry: QueueEntryRecord, siteId: string): unknown[] { return [entry.id, siteId, Buffer.from(entry.managementTokenHash), entry.nickname, entry.status, entry.joinedAt, entry.estimatedStartAt, entry.estimateConfidence, entry.assignedSlotId, entry.calledAt, entry.callExpiresAt, entry.chargingStartedAt, entry.initialChargeMinutes, entry.durationConfirmedAt, entry.expectedFinishAt, entry.finishConfirmationExpiresAt, entry.pushOptIn ?? false, entry.pushSubscriptionId ?? null, entry.fiveMinPushSentAt ?? null, entry.calledPushSentAt ?? null, entry.chargeEndPushSentAt ?? null, entry.joinIdempotencyKeyHash ? Buffer.from(entry.joinIdempotencyKeyHash) : null, entry.joinIdempotencyFingerprintHash ? Buffer.from(entry.joinIdempotencyFingerprintHash) : null, entry.lastMutationKeyHash ? Buffer.from(entry.lastMutationKeyHash) : null, entry.lastMutationFingerprintHash ? Buffer.from(entry.lastMutationFingerprintHash) : null, entry.lastMutationAt ?? null]; }

/** Deterministic in-memory implementation for local tests and Storybook-like use. */
export class InMemoryQueueStore implements QueueStore {
  private readonly sites = new Map<string, SiteRecord>();
  private readonly slots = new Map<string, QueueSlot[]>();
  private readonly entries = new Map<string, QueueEntryRecord[]>();
  private readonly locks = new Map<string, Promise<void>>();

  addSite(site: SiteRecord, slots: QueueSlot[] = []): void {
    this.sites.set(site.id, structuredClone(site));
    this.slots.set(site.id, slots.map(cloneSlot));
    this.entries.set(site.id, []);
  }
  addEntry(siteId: string, entry: QueueEntryRecord): void {
    const list = this.entries.get(siteId);
    if (!list) throw new Error("site not found");
    list.push(cloneEntry(entry));
  }
  async listSites(): Promise<SiteRecord[]> { return [...this.sites.values()].map((x) => ({ ...x })); }
  async lookupEntry(entryId: string): Promise<{ siteId: string; managementTokenHash: Uint8Array } | null> {
    for (const [siteId, entries] of this.entries) {
      const entry = entries.find((candidate) => candidate.id === entryId);
      if (entry) return { siteId, managementTokenHash: new Uint8Array(entry.managementTokenHash) };
    }
    return null;
  }

  async transaction<T>(siteId: string, fn: (tx: QueueTransaction) => Promise<T> | T, options: { lock?: boolean } = {}): Promise<T> {
    void options;
    const previous = this.locks.get(siteId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const pending = previous.then(() => current);
    this.locks.set(siteId, pending);
    await previous;
    try {
      const site = this.sites.get(siteId);
      if (!site) throw new ApiError("FACILITY_NOT_FOUND");
      const workingSite = { ...site };
      const workingSlots = (this.slots.get(siteId) ?? []).map(cloneSlot);
      const workingEntries = (this.entries.get(siteId) ?? []).map(cloneEntry);
      let changed = false;
      const tx: QueueTransaction = {
        site: workingSite,
        slots: workingSlots,
        entries: workingEntries,
        insertEntry: (entry) => { workingEntries.push(cloneEntry(entry)); changed = true; },
        deleteEntry: (entryId) => {
          const index = workingEntries.findIndex((entry) => entry.id === entryId);
          if (index >= 0) { workingEntries.splice(index, 1); changed = true; }
        },
        markChanged: () => { changed = true; },
        bumpVersion: () => { workingSite.queueVersion += 1; changed = true; return workingSite.queueVersion; },
        commit: async () => {
          if (!changed) return;
          this.sites.set(siteId, structuredClone(workingSite));
          this.slots.set(siteId, workingSlots.map(cloneSlot));
          this.entries.set(siteId, workingEntries.map(cloneEntry));
        },
      };
      const result = await fn(tx);
      await tx.commit();
      return result;
    } finally {
      release();
      if (this.locks.get(siteId) === pending) this.locks.delete(siteId);
    }
  }
}

function cloneSlot(slot: QueueSlot): QueueSlot {
  return { ...slot, estimatedAvailableAt: slot.estimatedAvailableAt ? new Date(slot.estimatedAvailableAt) : null };
}

function cloneEntry(entry: QueueEntryRecord): QueueEntryRecord {
  return {
    ...entry,
    managementTokenHash: new Uint8Array(entry.managementTokenHash),
    joinedAt: new Date(entry.joinedAt),
    estimatedStartAt: entry.estimatedStartAt ? new Date(entry.estimatedStartAt) : null,
    calledAt: entry.calledAt ? new Date(entry.calledAt) : null,
    callExpiresAt: entry.callExpiresAt ? new Date(entry.callExpiresAt) : null,
    chargingStartedAt: entry.chargingStartedAt ? new Date(entry.chargingStartedAt) : null,
    durationConfirmedAt: entry.durationConfirmedAt ? new Date(entry.durationConfirmedAt) : null,
    expectedFinishAt: entry.expectedFinishAt ? new Date(entry.expectedFinishAt) : null,
    finishConfirmationExpiresAt: entry.finishConfirmationExpiresAt ? new Date(entry.finishConfirmationExpiresAt) : null,
    fiveMinPushSentAt: entry.fiveMinPushSentAt ? new Date(entry.fiveMinPushSentAt) : null,
    calledPushSentAt: entry.calledPushSentAt ? new Date(entry.calledPushSentAt) : null,
    chargeEndPushSentAt: entry.chargeEndPushSentAt ? new Date(entry.chargeEndPushSentAt) : null,
    joinIdempotencyKeyHash: entry.joinIdempotencyKeyHash ? new Uint8Array(entry.joinIdempotencyKeyHash) : null,
    joinIdempotencyFingerprintHash: entry.joinIdempotencyFingerprintHash ? new Uint8Array(entry.joinIdempotencyFingerprintHash) : null,
    lastMutationKeyHash: entry.lastMutationKeyHash ? new Uint8Array(entry.lastMutationKeyHash) : null,
    lastMutationFingerprintHash: entry.lastMutationFingerprintHash ? new Uint8Array(entry.lastMutationFingerprintHash) : null,
    lastMutationAt: entry.lastMutationAt ? new Date(entry.lastMutationAt) : null,
  };
}

export function emptySlot(id: string, status: SlotStatus = "unknown"): QueueSlot {
  return { id, status, estimatedAvailableAt: null, activeEntryId: null };
}
