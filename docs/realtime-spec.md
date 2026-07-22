# Realtime仕様

## 目的

Realtimeは、同じ施設を見ている画面の順位、前方人数、待ち時間、状態を最新化するための内部更新イベントである。利用者へのWeb Push、音、振動、画面上の割り込み通知ではない。

## 送信経路と認可

```text
待ち列の更新をDBへ確定
→ charging_sites.queue_versionを更新
→ PostgreSQL Triggerがprivate Broadcastを送信
→ ブラウザが施設単位のprivate channelを受信
→ Route Handlerから最新状態を再取得
```

| 項目 | 値 |
|---|---|
| 提供基盤 | Supabase Realtime Broadcast |
| Topic | `site:<charging_site_id>` |
| Event | `queue_changed` |
| Payload | `{ "siteId": "uuid", "queueVersion": 123 }` |
| Channel | private |
| 送信者 | PostgreSQL Triggerだけ |
| ブラウザ権限 | `anon`ロールはBroadcastの受信（SELECT）だけ。INSERT policyは作らない。 |

`20260722010000_private_realtime_broadcast.sql` が、`queue_version`変更時のTriggerとRealtime受信ポリシーを作る。ブラウザ・Next.js Route HandlerはSupabaseのREST Broadcast APIを呼ばない。従って、公開可能なSupabase keyだけで偽の`queue_changed`を送って再取得を増幅する経路を持たない。

Supabase Dashboardでは、Realtime Settingsの「Allow public access」を無効にしてprivate channelのみを許可する。migration適用後、実Projectで`anon`ロールがprivate channelに接続でき、送信は拒否されることを必ず確認する。これは利用者ログインやSupabase Authの実装ではない。ユーザーアカウント、プロフィール、履歴データは作成しない。

## ブラウザ側の動作

1. 施設詳細画面を開いた時、その施設のprivate channelを購読する。
2. `queue_changed`を受けたら、payloadの`queueVersion`が現在値より新しい場合だけ受け付ける。1秒以内の複数イベントは最新値へcoalesceし、再取得を増幅させない。
3. 待ち列へ参加中なら`GET /api/queue/me`で本人状態を再取得する。施設詳細だけを見ている場合は`GET /api/sites/:siteId/summary`を再取得する。
4. 受信したデータでReact stateだけを更新し、ページ全体を再読み込みしない。

イベントにニックネーム、待ち列ID、管理トークン、Push Subscription ID、個別の順位や予定時刻を入れない。

## 切断・失敗時

- channelが切断・認可失敗・未設定の場合は、10〜15秒間隔で本人状態または施設集計を取得する。
- 再接続時は最新の状態を必ず再取得する。
- 再取得が失敗した場合は、最後に確認できた時刻と「最新情報を再取得」操作を表示する。
- Web Pushの配信可否はRealtimeの接続状態に影響しない。

## Web Pushとの違い

Web Pushを送るのは次の利用者行動が必要な時だけである。

1. 順番の約5分前
2. 順番到来（前の人の失効による繰り上げを含む）
3. 予定終了時刻の3分前の延長・終了確認

待ち列参加や他人の取消など、表示値だけが変わる通常の更新ではWeb Pushを送らない。
