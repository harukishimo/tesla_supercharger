# ローカル検証・引き継ぎ証跡

更新日：2026-07-22

## 実装対象

- Next.js App Router + TypeScript
- ルート`/`のスパQ入口画面と`/search`の待ち列アプリ画面
- Supabase Postgres用migration / seed（日本国内152施設・752ストール・752仮想site_slots）
- TypeScript待ち時間計算、待ち列状態遷移、Route Handler、外部Cronスケジューラー
- Supabase private Realtime Broadcast（DB Triggerによる施設version通知）とPolling fallback
- OneSignal Web Push（App ID・REST API Key設定時だけ有効。未設定時は画面内通知のみ）
- 任意のCloudflare Turnstile、IP・施設単位の簡易Rate Limit、CSP/HTTPヘッダー
- Vercel Firewall / WAFを主防御とする参加API保護の運用手順
- Vercel Hobbyでも動作する無料外部スケジューラーの運用手順
- 施設検索、満車確認、待機カウントダウン、呼出5分、初回30分、5〜120分入力、終了3分前の終了/延長、自動完了、利用規約・プライバシー画面

## 実行済みコマンド

| コマンド | 結果 |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS（production build + 11 tests） |
| `npm run db:validate` | PASS（静的152 / 752 / 152） |
| `DATABASE_URL=postgresql://127.0.0.1:... npm run db:validate -- --apply` | PASS（最新migration/seed、152 / 752 / 752） |
| 一時PostgreSQL + `PostgresQueueStore` join/dedupe/me/cancel | PASS |
| `.next/static`のserver-only秘密名検索 | クライアントバンドルに未露出 |
| 参加再送キーの永続ハッシュ重複防止 / body違い拒否 | PASS（InMemory統合テスト。Postgres適用後に同じケースを再確認） |
| Turnstile widget/tokenのUI結線静的確認 | PASS（Site Key設定時のexplicit script、Join/満車確認widget、token送信、tokenなしCTA無効化） |
| ルート画面 → `/search` の実ブラウザ遷移 | PASS（スパQ、説明、CTA、利用規約・プライバシーポリシー導線） |
| 390px幅の入口画面と使い方動画 | PASS（横スクロールなし、動画モーダル、MP4読込・自動再生、閉じる操作） |
| private Realtime migrationの通常PostgreSQL適用 | PASS（Realtime拡張のないローカルDBでは安全にskipし、seed検証を継続） |

一時PostgreSQLはローカル検証後に停止し、Supabase Cloudへは接続していない。

## 引き継ぎ前に運営者が行うこと

1. `.env.example`の変数（`QUEUE_IDEMPOTENCY_SECRET`を含む）をPreview / Productionそれぞれへ設定する。実値はリポジトリへ入れない。
2. Supabase CLIでmigrationを適用し、seedを一度だけ実行する。期待値は152施設、合計752ストール、752仮想slot。
3. Supabase Realtimeをprivate channel専用にし、migrationが作る受信専用policyとDB Triggerを確認する。OneSignal App / Service Worker、必要に応じてTurnstileも外部ダッシュボードで設定する。
4. Vercel Firewall / WAFで`/api/queue/join`のIP単位Rate Limitを設定する。Function内の簡易制限だけを公開時の主防御にしない。
5. Vercelへ接続し、`vercel.json`にCronが登録されていないことを確認する。外部スケジューラーから`CRON_SECRET`付きで`/api/cron/process-queue`を毎分呼び、HTTP 200と実行履歴を確認する。
6. Previewで検索、参加、退出、呼出、時間確定、完了、通知拒否、Realtime切断時のPollingをスモークテストする。

本リポジトリの実装エージェントは、秘密情報設定、Supabase Cloud反映、OneSignal/Turnstile設定、Vercelデプロイを実行していない。
