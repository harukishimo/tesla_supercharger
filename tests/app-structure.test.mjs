import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("スパQの入口画面・待ち列画面・安全な動線がある", async () => {
  const [landing, queuePage, shareDialog, installDialog, lineGate, layout, packageJson, realtimeMigration, realtimeClient, vercelConfig] = await Promise.all([
    read("app/page.tsx"),
    read("app/search/page.tsx"),
    read("app/components/share-qr-button.tsx"),
    read("app/components/install-app-button.tsx"),
    read("app/components/line-external-browser-gate.tsx"),
    read("app/layout.tsx"),
    read("package.json"),
    read("supabase/migrations/20260722020000_public_realtime_signal.sql"),
    read("lib/client/realtime.ts"),
    read("vercel.json"),
  ]);
  assert.match(landing, /スパQ/);
  assert.match(landing, /さっそく探す/);
  assert.match(landing, /使い方を見る/);
  assert.match(landing, /charge-queue-mock\.mp4/);
  assert.match(landing, /href="\/search"/);
  assert.match(landing, /ShareQrButton/);
  assert.match(landing, /InstallAppButton/);
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
  assert.match(queuePage, /terminalTransitionRef\.current/);
  assert.match(queuePage, /ShareQrButton/);
  assert.match(shareDialog, /知らなかった人に共有する/);
  assert.match(shareDialog, /share-supa-q-qr\.png/);
  assert.match(shareDialog, /aria-modal="true"/);
  assert.match(installDialog, /beforeinstallprompt/);
  assert.match(installDialog, /ios-home-screen-guide\.mp4/);
  assert.match(lineGate, /openExternalBrowser/);
  assert.match(lineGate, /Safari／Chromeで開いてください/);
  assert.match(layout, /LineExternalBrowserGate/);
  assert.doesNotMatch(queuePage, /advance-demo|MOCK/);
  assert.doesNotMatch(queuePage, /Google Maps|現在地から|近い順/);
  assert.match(layout, /lang="ja"/);
  assert.match(layout, /スパQ/);
  assert.match(realtimeMigration, /realtime\.send/);
  assert.match(realtimeMigration, /'site:' \|\| new\.id::text,\s*false/);
  assert.match(realtimeClient, /private: false/);
  assert.match(realtimeClient, /REALTIME_REFRESH_INTERVAL_MS = 5_000/);
  assert.doesNotMatch(realtimeClient, /access_token: publishableKey/);
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
    "supabase/migrations/20260722020000_public_realtime_signal.sql",
    "app/search/page.tsx",
    "app/components/share-qr-button.tsx",
    "app/components/install-app-button.tsx",
    "app/components/line-external-browser-gate.tsx",
    "supabase/seed/20260722_japan_superchargers.sql",
    ".env.example",
    "vercel.json",
    "public/manifest.webmanifest",
    "public/charge-queue-mock.mp4",
    "public/share-supa-q-qr.png",
    "public/ios-home-screen-guide.mp4",
    "public/apple-touch-icon.png",
    "public/icon-192.png",
    "public/icon-512.png",
    "public/OneSignalSDKWorker.js",
  ];
  await Promise.all(required.map((path) => access(new URL(path, root))));
});
