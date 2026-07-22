# Vercel デプロイ実行手順

スパQをVercelへ公開する運営者向けの手順である。秘密値はこの資料、Git、Issue、画面共有、Function Logへ記録しない。

## 現在の準備状況

- Supabase migrationは適用済み。
- 日本国内スーパーチャージャーのseedは適用済み（`charging_sites` 152件、`site_slots` 752件）。
- Vercel Project、環境変数、Firewall、Production Deployment、外部スケジューラーは運営者が設定する。

## 1. Vercel Projectを作成する

1. Vercel DashboardでGitHubの`harukishimo/tesla_supercharger`をImportする。
2. Framework Presetは`Next.js`、Root Directoryはリポジトリ直下（`.`）のままにする。
3. Build CommandとInstall Commandは上書きしない。`package.json`の`npm run build`が使用される。
4. Node.jsは`package.json`の`engines.node`に合わせて22系を使用する。
5. Production Domainを決める。仮の`*.vercel.app`でもよいが、決定後は必ず`NEXT_PUBLIC_APP_URL`、OneSignal、Turnstileへ同じoriginを設定する。

## 2. Vercelへ環境変数を登録する

Vercel Dashboardの **Project Settings → Environment Variables** で登録する。`NEXT_PUBLIC_*`はビルド時にブラウザへ埋め込まれるため、値を変更した後は必ず再デプロイする。

### Productionで必須

| 変数 | 値の取得元・入力ルール | 公開 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 既にローカルで使っているSupabase Project URL | 可 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Dashboard → Connect / API KeysのPublishable key | 可 |
| `SUPABASE_DATABASE_URL` | Supabase Dashboard → Connect → **Transaction pooler**。port `6543`、`sslmode=require`の接続文字列をそのまま登録 | 不可 |
| `NEXT_PUBLIC_APP_URL` | 正規の本番URL。例: `https://<production-domain>`。末尾の`/`は付けない | 可 |
| `QUEUE_IDEMPOTENCY_SECRET` | `openssl rand -base64 32`で生成した値。Productionでは今後も同じ値を保持する | 不可 |
| `NEXT_PUBLIC_TERMS_VERSION` | `2026-07-22` | 可 |
| `QUEUE_TERMS_VERSION` | `2026-07-22`。上の公開値と完全に一致させる | 不可 |
| `CRON_SECRET` | `openssl rand -base64 32`で生成した値 | 不可 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstileで作るProduction用WidgetのSite key | 可 |
| `TURNSTILE_SECRET_KEY` | 同じWidgetのSecret key | 不可 |

`SUPABASE_DATABASE_URL`にProject URL（`https://…supabase.co`）を入れてはいけない。Postgres接続文字列だけを使う。Transaction poolerのホスト名に`<REGION>`のようなプレースホルダーを残しても接続できないため、Dashboardが表示する実値をコピーする。

### Web Pushを公開時から有効にする場合に追加

| 変数 | 値の取得元・入力ルール | 公開 |
|---|---|---|
| `NEXT_PUBLIC_ONESIGNAL_APP_ID` | OneSignalのProduction Web Push App ID | 可 |
| `ONESIGNAL_REST_API_KEY` | 同じOneSignal AppのREST API Key | 不可 |

未設定でもアプリはデプロイできるが、ブラウザを閉じた際のPush通知は送られず、画面内表示のみになる。通知を要件どおりに使う公開では、この2値を設定する。

### Preview環境

Previewで待ち列操作を試す場合は、Productionと別のSupabase Project、OneSignal App、Turnstile Widget、各secretを設定する。本番DB・本番通知先をPreviewへ流用しない。

Previewを画面確認だけに限定するなら、DB接続値を入れず、待ち列APIが設定エラーになる状態で構わない。`NEXT_PUBLIC_APP_URL`はPreview URLを固定できないため、Production用の値をPreviewへコピーしない。

## 3. Vercel以外の管理画面で行う設定

### Supabase

1. Realtime Settingsで`Allow public access`を無効にする。
2. migration作成済みの`realtime.messages`の`SELECT TO anon` policyを確認する。
3. `INSERT TO anon` policyは作成しない。

### Cloudflare Turnstile

1. Production用Widgetを作り、許可hostnameにProduction Domainを登録する。
2. Site keyを`NEXT_PUBLIC_TURNSTILE_SITE_KEY`、Secret keyを`TURNSTILE_SECRET_KEY`へそれぞれ登録する。
3. Previewでも参加テストをする場合は、別Widgetを作りPreview用に登録する。

### OneSignal（Web Pushを使う場合）

1. OneSignalでWeb Push Appを作り、Site URLにProduction Domainを登録する。
2. App IDとREST API KeyをVercelへ登録する。
3. デプロイ後に`/OneSignalSDKWorker.js`がProduction Domainで`200`になることを確認する。このファイルはリポジトリに含まれている。

## 4. 初回Production Deployment

1. 上記のProduction環境変数を登録してから、`main`をProduction Branchとしてデプロイする。
2. VercelのBuild Logで`npm run build`が成功していることを確認する。
3. Project Settings → Cron Jobsで、`/api/cron/process-queue`と`* * * * *`が検出されていることを確認する。
4. `vercel.json`にはCronを登録していないことを確認する。Hobbyプランの毎分Cron制限を回避するためである。
5. cron-job.orgで次のJobを作成する。

   | 項目 | 入力値 |
   |---|---|
   | URL | `https://<production-domain>/api/cron/process-queue` |
   | Method | `GET` |
   | Header | `Authorization: Bearer <CRON_SECRET>` |
   | Schedule | Every minute |

   `CRON_SECRET`はVercelのserver-only環境変数と同じ値を使う。URLへsecretを埋め込まない。
6. JobのTest runでHTTP 200を確認し、実行履歴が毎分増えることを確認する。

## 5. Firewall / WAF

Vercel Dashboardの **Firewall** でProduction用ルールを作る。

| 対象 | 条件 | アクション | 初期値 |
|---|---|---|---|
| 待ち列参加 | Request Pathが`/api/queue/join`、Methodが`POST` | IP単位のRate Limit、超過時は`429` | 1分に3回、10分に10回 |
| API全体 | Request Pathが`/api/queue/*` | 監視。異常時はChallengeまたは一時Block | まずLogで観測 |

Rate Limitの提供範囲はVercelプランに依存する。利用できない場合、Function内の簡易制限だけを公開時の主防御にはせず、Turnstileを有効にしたまま対応プランまたは分散Rate Limitを選ぶ。

## 6. 公開後の確認

1. `/`、`/search`、`/api/sites`がHTTPSで開け、施設が取得できる。
2. 2つの別ブラウザで同じ施設を開き、参加・退出・充電開始によりもう一方の待ち表示が更新されることを確認する。
3. 充電時間の確定後、`終了予定まで`が秒単位で減り、残り3分で終了／延長確認が出ることを確認する。
4. 「目の前で空きができた」から充電開始した場合、待ち列の再計算と他画面の更新を確認する。
5. 外部スケジューラーの実行履歴、Vercel Function Log、Supabase Logを確認する。接続文字列、管理トークン、OneSignal API Key、Turnstile Secretが出力されていないことを確認する。
6. テストで作った待ち列は`充電が終わりました`または`待ち列から退出`で削除する。

## 公式資料

- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
- [cron-job.org](https://cron-job.org/en/)
- [cron-job.org REST API](https://docs.cron-job.org/rest-api.html)
- [Vercel環境変数](https://vercel.com/docs/environment-variables)
- [Vercel FirewallのRate Limit](https://vercel.com/kb/guide/add-rate-limiting-vercel)
- [Supabase Postgres接続方式](https://supabase.com/docs/guides/database/connecting-to-postgres)
