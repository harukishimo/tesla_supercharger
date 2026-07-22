# Realtime仕様

## 目的

Realtimeは、同じ施設を見ている画面の順位、前方人数、待ち時間、状態を最新化するための内部更新イベントである。利用者へのWeb Push、音、振動、画面上の割り込み通知ではない。

## 送信経路と認可

```text
待ち列の更新をDBへ確定
→ charging_sites.queue_versionを更新
→ PostgreSQL Triggerがpublic Broadcastを送信
→ ブラウザが施設単位のpublic channelを受信
→ Route Handlerから最新状態を再取得
```

| 項目 | 値 |
|---|---|
| 提供基盤 | Supabase Realtime Broadcast |
| Topic | `site:<charging_site_id>` |
| Event | `queue_changed` |
| Payload | `{ "siteId": "uuid", "queueVersion": 123 }` |
| Channel | public |
| 正規の送信者 | PostgreSQL Trigger |
| 信頼境界 | Broadcastは未認証の合図として扱い、業務データには使わない |

`20260722020000_public_realtime_signal.sql` が、`queue_version`変更時のTriggerをpublic Broadcastへ変更する。private channelはSupabase AuthのJWTを必要とするため、ログインを実装しない本サービスでは使用しない。

public Broadcastは第三者が偽のイベントを送れる可能性がある。そのためpayloadを状態更新には使用せず、施設IDと正の安全な更新番号を検査し、1秒に1回までのAPI再取得の合図にだけ使う。APIレスポンスだけを正本とし、Broadcastの更新番号を既知versionとして保存しない。ユーザーアカウント、プロフィール、履歴データは作成しない。

## ブラウザ側の動作

1. 施設詳細画面を開いた時、その施設のpublic channelを購読する。
2. `queue_changed`を受けたら、施設IDと`queueVersion`の形式を検査する。1秒以内の複数イベントは最新の合図へcoalesceし、再取得を増幅させない。
3. 待ち列へ参加中なら`GET /api/queue/me`で本人状態を再取得する。施設詳細だけを見ている場合は`GET /api/sites/:siteId/summary`を再取得する。
4. 受信したデータでReact stateだけを更新し、ページ全体を再読み込みしない。

イベントにニックネーム、待ち列ID、管理トークン、Push Subscription ID、個別の順位や予定時刻を入れない。

## 切断・失敗時

- channelが切断・未設定の場合は、15秒間隔で本人状態または施設集計を取得する。
- 再接続時は最新の状態を必ず再取得する。
- 再取得が失敗した場合は、最後に確認できた時刻と「最新情報を再取得」操作を表示する。
- Web Pushの配信可否はRealtimeの接続状態に影響しない。

## Web Pushとの違い

Web Pushを送るのは次の利用者行動が必要な時だけである。

1. 順番の約5分前
2. 順番到来（前の人の失効による繰り上げを含む）
3. 予定終了時刻の3分前の延長・終了確認

待ち列参加や他人の取消など、表示値だけが変わる通常の更新ではWeb Pushを送らない。
