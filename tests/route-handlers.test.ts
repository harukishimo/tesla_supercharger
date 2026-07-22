import assert from "node:assert/strict";
import test from "node:test";
import { emptySlot, InMemoryQueueStore, setQueueStoreForTests, type SiteRecord } from "../lib/server/db";
import { POST as joinPost } from "../app/api/queue/join/route";
import { GET as meGet } from "../app/api/queue/me/route";
import { GET as summaryGet } from "../app/api/sites/[siteId]/summary/route";
import { POST as skipStartPost } from "../app/api/queue/skip-start/route";

const site: SiteRecord = { id: "00000000-0000-4000-8000-000000000002", name: "APIテスト施設", address: "大阪府", stallCount: 1, defaultChargeMinutes: 45, queueEnabled: true, queueVersion: 0, queueStartedAt: null };

test("Route Handlerは共通JSON形式とトークン認証を守る", async () => {
  const store = new InMemoryQueueStore();
  store.addSite(site, [emptySlot("slot-api", "occupied")]);
  setQueueStoreForTests(store);
  try {
    const joinResponse = await joinPost(new Request("http://localhost/api/queue/join", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1", "idempotency-key": "route-test-1" },
      body: JSON.stringify({ siteId: site.id, nickname: "テスト", siteIsFull: true, acceptedTerms: true, termsVersion: "2026-07-22" }),
    }));
    assert.equal(joinResponse.status, 200);
    const joinBody = await joinResponse.json() as { data: { entryId: string; managementToken: string } };
    assert.ok(joinBody.data.entryId);
    assert.ok(joinBody.data.managementToken);
    const skipResponse = await skipStartPost(new Request("http://localhost/api/queue/skip-start", {
      method: "POST",
      headers: { "content-type": "application/json", "x-queue-token": joinBody.data.managementToken, "idempotency-key": "route-skip-start-1" },
      body: JSON.stringify({ entryId: joinBody.data.entryId }),
    }));
    assert.equal(skipResponse.status, 200);
    const skipBody = await skipResponse.json() as { data: { snapshot: { status: string; canSetDuration: boolean } } };
    assert.equal(skipBody.data.snapshot.status, "charging");
    assert.equal(skipBody.data.snapshot.canSetDuration, true);
    const duplicateJoinResponse = await joinPost(new Request("http://localhost/api/queue/join", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1", "idempotency-key": "route-test-1" },
      body: JSON.stringify({ siteId: site.id, nickname: "テスト", siteIsFull: true, acceptedTerms: true, termsVersion: "2026-07-22" }),
    }));
    assert.equal(duplicateJoinResponse.status, 200);
    const duplicateJoinBody = await duplicateJoinResponse.json() as { data: { entryId: string; managementToken: string } };
    assert.equal(duplicateJoinBody.data.entryId, joinBody.data.entryId);
    const conflictingKeyResponse = await joinPost(new Request("http://localhost/api/queue/join", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1", "idempotency-key": "route-test-1" },
      body: JSON.stringify({ siteId: site.id, nickname: "別入力", siteIsFull: true, acceptedTerms: true, termsVersion: "2026-07-22" }),
    }));
    assert.equal(conflictingKeyResponse.status, 409);
    const meResponse = await meGet(new Request(`http://localhost/api/queue/me?entryId=${joinBody.data.entryId}`, { headers: { "x-queue-token": joinBody.data.managementToken } }));
    assert.equal(meResponse.status, 200);
    const meBody = await meResponse.json() as { data: { status: string } };
    assert.equal(meBody.data.status, "charging");
    const badResponse = await meGet(new Request(`http://localhost/api/queue/me?entryId=${joinBody.data.entryId}`, { headers: { "x-queue-token": "wrong-token" } }));
    assert.equal(badResponse.status, 403);
    const summaryResponse = await summaryGet(new Request("http://localhost/api/sites/summary"), { params: Promise.resolve({ siteId: site.id }) });
    assert.equal(summaryResponse.status, 200);
  } finally {
    setQueueStoreForTests(undefined);
  }
});
