import assert from "node:assert/strict";
import test from "node:test";
import { extensionWindowOpen, isCallExpired, isFinishConfirmationDue, recalculateQueue, roundWaitMinutes } from "../lib/queue/recalculate";
import { confirmInitialDuration, extendCharging, startCharging, validateDuration, QueueDomainError } from "../lib/queue/state";
import type { QueueEntry, QueueSlot } from "../lib/queue/types";

const at = (value: string) => new Date(`2026-07-22T${value}:00+09:00`);
const slot = (id: string, available: string, status: QueueSlot["status"] = "occupied"): QueueSlot => ({
  id,
  status,
  estimatedAvailableAt: at(available),
  activeEntryId: null,
});
const waiting = (id: string, order: number, joined = "15:00"): QueueEntry => ({
  id,
  queueOrder: order,
  joinedAt: at(joined),
  status: "waiting",
  estimatedStartAt: null,
  estimateConfidence: "unknown",
  assignedSlotId: null,
  calledAt: null,
  callExpiresAt: null,
  chargingStartedAt: null,
  initialChargeMinutes: null,
  durationConfirmedAt: null,
  expectedFinishAt: null,
  finishConfirmationExpiresAt: null,
});

test("4ストールの同時空き予定はFIFOで10/25/25/25分になる", () => {
  const result = recalculateQueue({
    now: at("15:20"),
    slots: [slot("s1", "15:30"), slot("s2", "15:45"), slot("s3", "15:45"), slot("s4", "15:45")],
    entries: [waiting("a", 1), waiting("b", 2), waiting("c", 3), waiting("d", 4)],
    assignCalled: false,
  });
  assert.deepEqual(result.entries.map((entry) => entry.estimatedStartAt?.toISOString().slice(11, 16)), ["06:30", "06:45", "06:45", "06:45"]);
  assert.deepEqual(result.entries.map((entry) => roundWaitMinutes(Math.ceil((entry.estimatedStartAt!.getTime() - at("15:20").getTime()) / 60_000))), [10, 25, 25, 25]);
  assert.equal(result.waitingCount, 4);
});

test("空きストールがあれば先頭だけがcalledになり、残りはwaiting", () => {
  const result = recalculateQueue({
    now: at("15:20"),
    slots: [slot("s1", "15:20", "available"), slot("s2", "15:45")],
    entries: [waiting("a", 1), waiting("b", 2)],
  });
  assert.equal(result.entries[0].status, "called");
  assert.equal(result.entries[0].callExpiresAt?.toISOString().slice(11, 16), "06:25");
  assert.equal(result.entries[1].status, "waiting");
  assert.equal(result.waitingCount, 1);
});

test("初回時間は30分を確定し、確定後の再確定を拒否する", () => {
  const base = startCharging({ ...waiting("a", 1), status: "called", assignedSlotId: "s1", calledAt: at("15:20"), callExpiresAt: at("15:25") }, at("15:20"));
  const confirmed = confirmInitialDuration(base, 30, at("15:21"));
  assert.equal(confirmed.initialChargeMinutes, 30);
  assert.equal(confirmed.expectedFinishAt?.toISOString().slice(11, 16), "06:50");
  assert.throws(() => confirmInitialDuration(confirmed, 40, at("15:22")), (error: unknown) => error instanceof QueueDomainError && error.code === "DURATION_ALREADY_CONFIRMED");
});

test("延長は終了予定3分前から5分後まで、5〜120分だけ許可する", () => {
  const charging: QueueEntry = {
    ...waiting("a", 1), status: "charging", assignedSlotId: "s1", chargingStartedAt: at("15:00"),
    initialChargeMinutes: 30, durationConfirmedAt: at("15:01"), expectedFinishAt: at("15:30"), finishConfirmationExpiresAt: at("15:35"),
  };
  assert.equal(extensionWindowOpen(at("15:30"), at("15:27")), true);
  assert.equal(extensionWindowOpen(at("15:30"), at("15:36")), false);
  const extended = extendCharging(charging, 15, at("15:28"));
  assert.equal(extended.expectedFinishAt?.toISOString().slice(11, 16), "06:45");
  assert.throws(() => validateDuration(121), (error: unknown) => error instanceof QueueDomainError && error.code === "DURATION_OUT_OF_RANGE");
});

test("呼出と終了確認の期限判定は境界を含む", () => {
  assert.equal(isCallExpired({ status: "called", callExpiresAt: at("15:25") }, at("15:25")), true);
  assert.equal(isFinishConfirmationDue({ status: "charging", finishConfirmationExpiresAt: at("15:35") }, at("15:35")), true);
});
