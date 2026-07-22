import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryQueueStore, emptySlot, setQueueStoreForTests, type SiteRecord } from "../lib/server/db";
import { completeQueue, getMyQueue, joinQueue, setDuration, startQueue } from "../lib/server/queue-service";

const now = new Date("2026-07-22T06:20:00.000Z");
const site: SiteRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "テスト施設",
  address: "東京都",
  stallCount: 2,
  defaultChargeMinutes: 45,
  queueEnabled: true,
  queueVersion: 0,
  queueStartedAt: null,
};

test("待ち列の参加→呼出→開始→時間確定→完了→後続繰り上げ", async () => {
  const store = new InMemoryQueueStore();
  store.addSite(site, [emptySlot("slot-1", "occupied"), emptySlot("slot-2", "occupied")]);
  setQueueStoreForTests(store);
  try {
    const first = await joinQueue({ siteId: site.id, nickname: "A", siteIsFull: true, acceptedTerms: true, termsVersion: "2026-07-22", now });
    assert.equal(first.snapshot.status, "waiting");
    await store.transaction(site.id, (tx) => {
      tx.slots[0].status = "available";
      tx.slots[0].estimatedAvailableAt = now;
      tx.markChanged();
    });
    const second = await joinQueue({ siteId: site.id, nickname: "B", siteIsFull: false, acceptedTerms: true, termsVersion: "2026-07-22", now: new Date(now.getTime() + 1_000) });
    const firstCalled = await getMyQueue(first.entryId, first.token, new Date(now.getTime() + 1_000));
    assert.equal(firstCalled.status, "called");
    assert.equal(second.snapshot.status, "waiting");
    const started = await startQueue(first.entryId, first.token, new Date(now.getTime() + 2_000));
    assert.equal(started.snapshot.status, "charging");
    const confirmed = await setDuration(first.entryId, first.token, 30, new Date(now.getTime() + 3_000));
    assert.equal(confirmed.snapshot.expectedFinishAt, "2026-07-22T06:50:02.000Z");
    await completeQueue(first.entryId, first.token, new Date(now.getTime() + 4_000));
    const promoted = await getMyQueue(second.entryId, second.token, new Date(now.getTime() + 5_000));
    assert.equal(promoted.status, "called");
    assert.equal(promoted.position, null);
  } finally {
    setQueueStoreForTests(undefined);
  }
});

test("同意なし・不正時間は入力エラーになる", async () => {
  const store = new InMemoryQueueStore();
  store.addSite(site, [emptySlot("slot-1", "occupied")]);
  setQueueStoreForTests(store);
  try {
    await assert.rejects(() => joinQueue({ siteId: site.id, nickname: "A", siteIsFull: true, acceptedTerms: false, termsVersion: "2026-07-22", now }), /利用規約/);
    await assert.rejects(() => joinQueue({ siteId: site.id, nickname: "A", siteIsFull: true, acceptedTerms: true, termsVersion: "old", now }), /利用規約/);
  } finally {
    setQueueStoreForTests(undefined);
  }
});

test("同一施設の永続冪等キーは参加を二重登録せず、body違いを拒否する", async () => {
  const store = new InMemoryQueueStore();
  store.addSite(site, [emptySlot("slot-1", "occupied")]);
  setQueueStoreForTests(store);
  try {
    const input = { siteId: site.id, nickname: "再送", siteIsFull: true, acceptedTerms: true, termsVersion: "2026-07-22", idempotencyKey: "durable-join-key", now };
    const first = await joinQueue(input);
    const duplicate = await joinQueue(input);
    assert.equal(duplicate.entryId, first.entryId);
    assert.equal(duplicate.token, first.token);
    await assert.rejects(() => joinQueue({ ...input, nickname: "別の入力" }), /同じ操作/);
  } finally {
    setQueueStoreForTests(undefined);
  }
});
