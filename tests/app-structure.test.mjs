import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("スパQの入口画面・待ち列画面・安全な動線がある", async () => {
  const [landing, queuePage, layout, packageJson, realtimeMigration, vercelConfig] = await Promise.all([
    read("app/page.tsx"),
    read("app/search/page.tsx"),
    read("app/layout.tsx"),
    read("package.json"),
    read("supabase/migrations/20260722010000_private_realtime_broadcast.sql"),
    read("vercel.json"),
  ]);
  assert.match(landing, /スパQ/);
  assert.match(landing, /さっそく探す/);
  assert.match(landing, /使い方を見る/);
  assert.match(landing, /charge-queue-mock\.mp4/);
  assert.match(landing, /href="\/search"/);
  assert.match(queuePage, /api\/queue\/join/);
  assert.match(queuePage, /api\/queue\/me/);
  assert.match(queuePage, /api\/queue\/duration/);
  assert.match(queuePage, /api\/queue\/extend/);
  assert.match(queuePage, /api\/queue\/skip-start/);
  assert.match(queuePage, /周りに並んでいそうな車両はいませんか？/);
  assert.match(queuePage, /useCountdownSeconds/);
  assert.match(queuePage, /formatCountdown/);
  assert.match(queuePage, /remainingPercent/);
  assert.match(queuePage, /className="brand" href="\/"/);
  assert.match(queuePage, /スパQのホームへ戻る/);
  assert.doesNotMatch(queuePage, /advance-demo|MOCK/);
  assert.doesNotMatch(queuePage, /Google Maps|現在地から|近い順/);
  assert.match(layout, /lang="ja"/);
  assert.match(layout, /スパQ/);
  assert.match(realtimeMigration, /realtime\.send/);
  assert.match(realtimeMigration, /for select/);
  assert.doesNotMatch(realtimeMigration, /for insert\s+to anon/);
  assert.match(packageJson, /"next":/);
  assert.doesNotMatch(vercelConfig, /"crons"/);
});

test("Route HandlerとPWAの構成ファイルが揃っている", async () => {
  const required = [
    "app/api/sites/route.ts",
    "app/api/sites/[siteId]/summary/route.ts",
    "app/api/queue/join/route.ts",
    "app/api/queue/me/route.ts",
    "app/api/queue/cancel/route.ts",
    "app/api/queue/start/route.ts",
    "app/api/queue/skip-start/route.ts",
    "app/api/queue/duration/route.ts",
    "app/api/queue/extend/route.ts",
    "app/api/queue/complete/route.ts",
    "app/api/cron/process-queue/route.ts",
    "supabase/migrations/20260722000000_initial_queue_schema.sql",
    "supabase/migrations/20260722010000_private_realtime_broadcast.sql",
    "app/search/page.tsx",
    "supabase/seed/20260722_japan_superchargers.sql",
    ".env.example",
    "vercel.json",
    "public/manifest.webmanifest",
    "public/charge-queue-mock.mp4",
    "public/OneSignalSDKWorker.js",
  ];
  await Promise.all(required.map((path) => access(new URL(path, root))));
});
