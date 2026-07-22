# Supabase設定手順（運営者向け）

この手順は、運営者がSupabase Projectを作成した後に行う設定である。実値、Project Ref、接続文字列はこのリポジトリやエージェントへ入力しない。

## 1. DBを反映する

1. Supabase CLIで対象Projectへリンクする。
2. `supabase db push`で`supabase/migrations/`を順番に適用する。
3. `supabase/seed/20260722_japan_superchargers.sql`を一度だけ実行する。
4. `charging_sites = 152`、`sum(stall_count) = 752`、`site_slots = 752`を確認する。

アプリのDB操作には`SUPABASE_DATABASE_URL`だけを使う。`SUPABASE_SERVICE_ROLE_KEY`は設定・使用しない。

## 2. 通常のDB認可（RLS）を確認する

初期migrationは`charging_sites`、`site_slots`、`queue_entries`のRLSを有効化し、`anon`と`authenticated`からの直接権限を外す。

目的は、ブラウザがSupabase REST APIを直接叩いて待ち列を追加・変更・閲覧できないようにすること。利用者の参加・開始・終了は、Next.js Route Handlerを経由し、管理トークン照合後にだけDBへ反映する。

これはログイン機能ではない。Supabase Auth、匿名Auth、電話番号、メール、OTP、利用者プロフィールは使わない。

## 3. ログイン不要のRealtimeを設定する

1. `20260722020000_public_realtime_signal.sql`までmigrationを適用する。
2. Realtime Settingsで「Allow public access」を有効にする。
3. `charging_sites.queue_version`が変わると、DB Triggerが`site:<施設UUID>`へ`queue_changed`を送ることを確認する。

ブラウザは通知を受けた後にNext.js APIから最新状態を読み直すため、Realtime payloadにニックネーム・管理トークン・待ち列詳細は含まれない。public channelのpayloadは未認証なので、画面状態の正本には使用しない。

private channelはSupabase AuthのJWTが必要になる。ログイン機能を持たない現在仕様ではpublic channelを再取得の合図に限定し、アカウント保存を行わない。

## 4. 確認チェック

- ブラウザから`charging_sites`、`site_slots`、`queue_entries`へ直接アクセスできない。
- Next.js API経由の検索、参加、充電開始、時間確定、延長、終了、退出が動く。
- 同じ施設を開く別ブラウザで、DB更新後にpublic Realtimeを受信し、APIから最新値を再取得する。
- 不正なpayload、別施設ID、連続イベントを受けても値を直接反映せず、再取得が1秒に1回を超えない。
- Realtimeを切断しても、10〜15秒のPollingで状態が更新される。
