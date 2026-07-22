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

## 3. private Realtimeを設定する

1. Realtime Settingsで「Allow public access」を無効にする。
2. migrationが`realtime.messages`へ作成した`SELECT TO anon` policyを確認する。
3. `INSERT TO anon` policyを作らない。ブラウザは受信だけを許可する。
4. `charging_sites.queue_version`が変わると、DB Triggerが`site:<施設UUID>`へ`queue_changed`を送ることを確認する。

これにより、待ち列のDB更新だけがRealtime通知を作れる。ブラウザは通知を受けた後にNext.js APIから最新状態を読み直すため、Realtime payloadにニックネーム・管理トークン・待ち列詳細は含まれない。

`anon`はSupabase接続時の匿名ロールであり、ユーザー登録やアカウント保存ではない。private channelへの実接続は、Projectでmigrationを適用したPreview環境で必ず確認する。

## 4. 確認チェック

- ブラウザから`charging_sites`、`site_slots`、`queue_entries`へ直接アクセスできない。
- Next.js API経由の検索、参加、充電開始、時間確定、延長、終了、退出が動く。
- 同じ施設を開く別ブラウザで、DB更新後にprivate Realtimeを受信する。
- Browser clientからBroadcast送信を試しても拒否される。
- Realtimeを切断しても、10〜15秒のPollingで状態が更新される。
