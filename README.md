# スパQ

Tesla Japanのスーパーチャージャー施設で、現地の状況を利用者同士で共有する待ち列Webアプリです。Tesla公式アプリではなく、待ち時間・施設の利用可否・ストール数を保証しません。現地の案内を常に優先してください。

## ローカル開発

前提は Node.js `>=22.13.0` です。

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local`には実値を入れてよいのはローカル環境だけです。`.env.local`、SupabaseのService Role Key、DB接続文字列、OneSignal REST API Key、Turnstile Secret Key、管理トークン原文をGitへ追加しないでください。公開してよい値とサーバー専用の秘密値は[docs/deployment-configuration.md](docs/deployment-configuration.md)の表に分けて記載しています。

## 検証コマンド

```bash
npm run lint       # ESLint
npm run typecheck  # TypeScript（noEmit）
npm test           # production build + domain/API/UI tests
npm run build      # production buildのみ
```

施設スナップショットはCSV 152件、合計752ストールです。SQLへ接続しない静的検証はいつでも実行できます。

```bash
npm run db:validate
```

空のローカルPostgreSQLへmigrationとseedを適用して検証する場合は、localhostの接続文字列だけを環境変数へ渡し、`--apply`を付けます。検証スクリプトはリモートホスト（Supabase Cloudを含む）を拒否します。

```bash
DATABASE_URL='postgresql://<user>:<password>@localhost:<port>/<database>' \
  npm run db:validate -- --apply
```

成功時の期待値は `152 charging_sites`、`sum(stall_count) = 752`、`752 site_slots` です。既存データのあるDBへ適用するスクリプトではありません。DBを消去する必要がある場合は、対象を確認したうえで運営者がローカル環境だけを明示的に再作成してください。Supabase CLI/Dockerが使えない環境でも、静的検証の結果と接続エラーを隠さず表示します。

## データの更新方針

- 正本CSV: `data/tesla-japan-superchargers-2026-07-22.csv`
- migration: `supabase/migrations/20260722000000_initial_queue_schema.sql`
- seed: `supabase/seed/20260722_japan_superchargers.sql`
- 調査根拠と再確認手順: [docs/tesla-japan-supercharger-research.md](docs/tesla-japan-supercharger-research.md)

seedは公式施設URLをキーにupsertし、不足する仮想スロットだけを追加します。余分なスロットを削除しないため、待ち列がある施設へストール数を減らす更新を適用しないでください。`queue_entries`はseedへ含めず、利用者の有効な待ち列だけを保持します。

## 運営者向け Supabase 引き継ぎ

実値の作成・入力は運営者の端末で行ってください。このリポジトリやエージェントはSupabase Cloudへ接続・適用しません。

1. Supabaseでプロジェクトを作成し、リージョン、バックアップ、接続プール設定を確認する。
2. Supabase CLIを運営者の端末へインストールし、`supabase login`後に`supabase link --project-ref <PROJECT_REF>`を実行する。
3. `supabase db push`で`supabase/migrations`を適用する。migrationは未適用ファイルだけを順番に適用し、完了済みファイルを編集しない。
4. DB接続文字列を一時的に`SUPABASE_DATABASE_URL`へ設定し、seedを一度だけ実行する。例（値は運営者のシェルでのみ解決する）：

   ```bash
   psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 \
     -f supabase/seed/20260722_japan_superchargers.sql
   ```

5. Supabase SQL Editorまたは安全な管理接続で、`charging_sites`が152件、`sum(stall_count)`が752、`site_slots`が752件であることを確認する。RLSが3テーブルで有効、匿名ロールに権限がないことも確認する。
6. `SUPABASE_DATABASE_URL`やDBパスワードをシェル履歴・ログ・Issueへ残さず、作業後に環境変数を解除する。

## 運営者向け Vercel 引き継ぎ

VercelのPreviewとProductionは環境変数を分けます。Previewでは本番と別のSupabase/OneSignal値を使い、本番の通知先へ送らないでください。

### 公開変数

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_ONESIGNAL_APP_ID`（Web Pushを有効にする場合）
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`（Turnstile採用時のみ）
- `NEXT_PUBLIC_TERMS_VERSION`（利用規約・プライバシーポリシーの公開バージョン。`QUEUE_TERMS_VERSION`と一致させる）

### サーバー専用変数

- `SUPABASE_DATABASE_URL`
- `ONESIGNAL_REST_API_KEY`（Web Pushを有効にする場合）
- `CRON_SECRET`（Cron Routeを有効にする場合）
- `TURNSTILE_SECRET_KEY`（Turnstile採用時のみ）
- `QUEUE_IDEMPOTENCY_SECRET`（本番の再送時に同じ管理トークンを復元するserver-only秘密値）
- `QUEUE_TERMS_VERSION`（利用規約・プライバシーポリシーのサーバー側バージョン）

Vercel DashboardのProject Settings → Environment Variablesで、変数ごとにPreview / Productionの適用先を選択します。サーバー専用変数に`NEXT_PUBLIC_`を付けず、ブラウザへ返すレスポンス・HTML・ログへ秘密値を含めないでください。`SUPABASE_SERVICE_ROLE_KEY`はこの構成では使用しません。

Web Pushを有効にする場合は、`NEXT_PUBLIC_ONESIGNAL_APP_ID`を設定してビルドし、同一originの`/OneSignalSDKWorker.js`が公開されることを確認します。通知許可は待ち列参加後の利用者操作でのみ求めます。App ID未設定時は、待機画面を正とする画面内通知へフォールバックします。

## デプロイ後スモークテスト

運営者がPreviewで確認してからProductionへ反映します。

1. `https://<deployment>/`がHTTPSで開き、施設検索と待ち列画面が表示される。
2. `npm run build`相当のVercel Buildが成功し、ブラウザのConsoleへ秘密値が出ていない。
3. 施設検索で「東京」「北海道」などを入力し、候補がネットワークエラーなしに絞り込まれる。
4. 実装済みの施設サマリーAPIがある場合は、1施設の取得が成功し、152施設のうち1件を表示できる。
5. 待ち列参加、本人状態取得、退出をテスト用施設・テスト用トークンで一度ずつ行う。管理トークンをURLやスクリーンショットへ残さない。
6. Realtime切断時の再取得、失敗時のエラー表示、（有効化した場合）OneSignal通知許可とCronの認証を確認する。
7. Supabaseの監視・Vercel Functionログ・Cron実行履歴に、DB接続文字列、管理トークン、Push APIキーが記録されていないことを確認する。

## 正本資料

実装範囲と変更ルールは[docs/implementation-plan.md](docs/implementation-plan.md)、DB契約は[docs/database-schema.md](docs/database-schema.md)、外部サービス設定は[docs/deployment-configuration.md](docs/deployment-configuration.md)、UI基準は[DESIGN.md](DESIGN.md)を参照してください。
