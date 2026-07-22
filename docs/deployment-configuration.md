# 環境変数・外部サービス設定

## 採用サービス

- Vercel: Next.jsの配信、Route Handler、Cron
- Supabase: Postgres、migration、private Realtime Broadcast
- OneSignal: ブラウザのWeb Push
- Cloudflare Turnstile: 一般公開時に任意で追加するCAPTCHA

SMS、メール、Firebase Cloud Messaging、Supabase Authは使用しない。

## 環境変数

| 変数名 | 公開 | 用途 | 必須時期 |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 可 | ブラウザのRealtime接続 | 初期から |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 可 | ブラウザのRealtime接続 | 初期から |
| `NEXT_PUBLIC_ONESIGNAL_APP_ID` | 可 | OneSignal Web SDKの初期化 | Web Pushを有効化する時 |
| `NEXT_PUBLIC_APP_URL` | 可 | 通知クリック先、Service Workerのorigin確認、OGのcanonical origin | 初期から |
| `SUPABASE_DATABASE_URL` | 不可 | Route HandlerからのDBトランザクション接続 | 初期から |
| `ONESIGNAL_REST_API_KEY` | 不可 | サーバー側からのPush送信 | Web Pushを有効化する時 |
| `CRON_SECRET` | 不可 | Vercel Cron用エンドポイントの保護 | 定期処理を有効化する時 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | 可 | CAPTCHAのウィジェット表示 | Productionの待ち列参加前 |
| `TURNSTILE_SECRET_KEY` | 不可 | CAPTCHA tokenのサーバー検証 | Productionの待ち列参加前 |
| `QUEUE_IDEMPOTENCY_SECRET` | 不可 | 再送時の決定的トークン復元。待ち列参加の管理トークンをDBへ平文保存せず、全Vercelインスタンスで同じ値を再現する | 本番の待ち列参加で必須 |
| `NEXT_PUBLIC_TERMS_VERSION` / `QUEUE_TERMS_VERSION` | 前者のみ可 | 利用規約の公開・サーバー側バージョン | 初期から。同じ値にする |

`SUPABASE_DATABASE_URL`、`ONESIGNAL_REST_API_KEY`、`CRON_SECRET`、`TURNSTILE_SECRET_KEY`、`QUEUE_IDEMPOTENCY_SECRET`を`NEXT_PUBLIC_*`にしてはならない。`SUPABASE_SERVICE_ROLE_KEY`もこの構成では不要であり、設定しない。

`NEXT_PUBLIC_APP_URL`は運営者が許可した正規origin（末尾スラッシュなし）を設定する。画面のHostヘッダーからOG URLを生成しないため、プロキシ経由のHost Header Injectionを避けられる。

`SUPABASE_DATABASE_URL`には、Supabase Dashboardの**Connect → Transaction pooler**で取得する接続文字列（port `6543`、`sslmode=require`）を設定する。Vercelのようなサーバーレス実行環境では、migration用のDirect connectionではなくTransaction poolerを使う。

## OneSignalだけで足りる範囲

ブラウザを閉じている時にもOSの通知を出すWeb PushにはOneSignalだけで足りる。OneSignal Web SDK、OneSignalのService Worker、App ID、REST API Keyを設定する。FirebaseやSMS事業者は追加しない。

画面を開いている時のバナー、色、音、振動はNext.jsアプリ内で実装するため、OneSignalを使わない。

Web PushにはHTTPS、同一originのService Worker、利用者の明示的な通知許可が必要である。iPhone/iPadはiOS/iPadOS 16.4以降で、ホーム画面へ追加したWebアプリから許可する導線を用意する。

## Vercel設定

- `.env.local`はローカル専用とし、Gitへ追加しない。
- VercelのPreviewとProductionで環境変数を分離する。
- Previewは別のOneSignal App IDとREST API Keyを使い、本番の通知先へ送らない。
- `vercel.json`でCronの実行先を`/api/cron/process-queue`として登録する。
- Cronエンドポイントは`CRON_SECRET`で検証する。
- 現在の`* * * * *`（毎分）Cronには、毎分Cronを利用できるVercelプランが必要である。Hobbyプランでは1日1回より高頻度なCronを設定できない。
- Vercel CronはProduction Deploymentだけで動作する。Previewでは開発者がCron用エンドポイントを手動実行して確認する。

## Vercel Firewall / WAF（待ち列参加の保護）

待ち列参加のRate Limitは、Vercel Function内のメモリだけへ依存しない。Vercel DashboardのFirewall / WAFで、ProductionとPreviewを分けて次のルールを設定する。

| 対象 | ルール | 目的 |
|---|---|---|
| `/api/queue/join` | IP単位のRate Limit | 短時間の連続参加・Botによる待ち列荒らしを遮断する |
| `/api/queue/*` | Bot対策・異常トラフィック監視 | 既存の管理トークン照合を補完する |

具体的な回数・時間枠は、Previewで通常操作とTurnstileの通過を確認してから運営者が決める。目安は「同一IP・同一施設への参加を1分あたり3回、10分あたり10回まで」とし、通常利用を妨げる場合は緩和する。WAFはVercelの信頼できる接続元IPを基準に判定するため、アプリコードで`X-Forwarded-For`を信頼するより安全である。

Function内の簡易Rate Limitは二次防御として残すが、公開時の主防御はWAFとTurnstileにする。

## Supabase Realtimeの運用設定

1. `20260722010000_private_realtime_broadcast.sql`までmigrationを適用する。
2. Supabase DashboardのRealtime Settingsで「Allow public access」を無効にし、private channelだけを許可する。
3. `realtime.messages`に作られた`SELECT TO anon` policyを確認する。`INSERT TO anon` policyは追加しない。
4. 2つのブラウザで同じ施設を開き、片方の待ち列操作後にもう片方が再取得することを確認する。
5. ブラウザのConsoleからBroadcast送信を試み、拒否されることを確認する。切断時は10〜15秒のPollingで最新化されることも確認する。

この設定は利用者ログインを作らない。`anon`はSupabase接続上の匿名ロールであり、ユーザーアカウントや履歴テーブルを作成しない。

## CAPTCHAの扱い

限定公開・ローカル開発ではTurnstileを設定せずに開始できる。現行実装の`NODE_ENV=production`では`TURNSTILE_SECRET_KEY`未設定を設定不備として拒否する。したがってProductionで待ち列参加を使うには、`NEXT_PUBLIC_TURNSTILE_SITE_KEY`と`TURNSTILE_SECRET_KEY`の両方を設定し、Cloudflare Turnstile側へ本番originを登録する。

Vercelへ入力する順番、環境別の設定値、公開後チェックは[vercel-deployment-runbook.md](vercel-deployment-runbook.md)を正本とする。
