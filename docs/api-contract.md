# API仕様

このAPIは外部公開用ではなく、ブラウザ画面からNext.js Route Handlerを呼ぶための内部HTTP APIである。ブラウザからSupabaseの待ち列テーブルを直接操作しない。

## 共通ルール

- 形式はJSON、文字コードはUTF-8とする。
- 施設検索以外の待ち列操作は`entryId`と管理トークンを必要とする。
- 管理トークンは`X-Queue-Token`ヘッダーで渡す。参加APIのレスポンスで一度だけ返し、ブラウザの`localStorage`へ保存する。
- 成功レスポンスは`{ "data": ... }`、失敗レスポンスは`{ "error": { "code", "message", "retryable" } }`とする。`code`と利用者向け`message`は`docs/error-catalog.md`に定義されたものだけを使う。
- すべての状態変更は、対象施設をロックしたDBトランザクション内でTypeScriptの待ち列サービスを実行する。
- POSTの`Idempotency-Key`は同一操作の通信再送で同じ値を使う。参加・状態変更のキー/fingerprintは有効な`queue_entries`へハッシュだけ一時保存し、成功済みのレスポンス本体や管理トークンはサーバーのメモリへ保持し続けない。
- 同一キーでbodyが異なる再送は`IDEMPOTENCY_KEY_REUSED`（409）として拒否する。完了・退出後は対象行が削除されるため、クライアントは成功レスポンス受領後にキーを破棄する。

## ブラウザから呼ぶAPI

| Method / Path | 用途 | 主な入力 | 主な出力 |
|---|---|---|---|
| `GET /api/sites` | 施設検索用の初期一覧取得 | なし | 施設ID、名称、住所、検索用文字列 |
| `GET /api/sites/:siteId/summary` | 選択施設の公開状況取得 | `siteId` | 受付可否、待ち人数、参考待ち時間、`queueVersion` |
| `POST /api/queue/join` | 待ち列へ参加 | `siteId`、`nickname`、`siteIsFull`、`acceptedTerms`、`termsVersion`、任意で`turnstileToken` | `entryId`、管理トークン、本人用待機状態 |
| `GET /api/queue/me?entryId=...` | 本人の最新状態取得 | `entryId`、`X-Queue-Token` | 順位、前方人数、推定開始、状態、操作可能フラグ |
| `POST /api/queue/cancel` | 待ち列から退出 | `entryId`、管理トークン | 退出結果 |
| `POST /api/queue/start` | 充電開始を報告 | `entryId`、管理トークン | 充電中状態、入力待ちの予定時間 |
| `POST /api/queue/duration` | 初回の充電予定時間を確定 | `entryId`、管理トークン、`minutes` | 終了予定、再計算後の状態。確定済みなら拒否 |
| `POST /api/queue/extend` | 追加充電時間を確定 | `entryId`、管理トークン、`additionalMinutes` | 新しい終了予定、再計算後の状態。終了予定3分前の確認中だけ許可 |
| `POST /api/queue/complete` | 充電完了を報告 | `entryId`、管理トークン | 完了結果 |
| `POST /api/queue/push-subscription` | Web Pushを待ち列へ一時紐付け | `entryId`、管理トークン、`subscriptionId` | 登録結果 |

`GET /api/sites`は最初に一覧を取得してブラウザ内で検索する。キー入力のたびには呼ばない。施設数が大きくなった場合だけ、同じエンドポイントへ検索文字列を付けたサーバー側検索へ移行する。

## サーバー内部API

| Method / Path | 呼び出し元 | 用途 |
|---|---|---|
| `GET /api/cron/process-queue` | Vercel Cronのみ | 順番5分前、終了3分前、呼び出し失効、終了予定+5分の自動完了を処理 |

Cron用エンドポイントは秘密値で保護し、通常のブラウザ操作からは呼べないようにする。

## 入力値の制約

- `nickname`: 1〜30文字。制御文字を除外し、画面表示時はエスケープする。
- `minutes` / `additionalMinutes`: 5〜120の整数。
- `POST /api/queue/duration`は、初回の予定時間が未確定の場合だけ成功する。入力後に任意の予定時間変更はできない。
- `POST /api/queue/extend`は、予定終了時刻の3分前から予定終了時刻の5分後までの確認中だけ成功する。
- `siteIsFull`: Route Handlerが施設ロック後に有効な待機者0人と判定した場合だけ`true`を必須とする。これは利用者の初回利用ではなく、待ち時間0分から待ち列を新規開始する場合の確認である。
- `acceptedTerms`: `true`を必須とする。未同意なら`TERMS_NOT_ACCEPTED`を返す。
- `termsVersion`: 公開中の利用規約・プライバシーポリシーのバージョンと一致する文字列を必須とする。最新でなければ`TERMS_VERSION_OUTDATED`を返す。確認のために受け取るだけで、利用者の同意履歴として長期保存しない。
- `turnstileToken`: CAPTCHAを有効化した場合だけ必須とする。

## エラー形式

```json
{
  "error": {
    "code": "INVALID_QUEUE_STATE",
    "message": "待ち列の状態が更新されています。最新の内容を確認してください。",
    "retryable": true
  }
}
```

代表的なHTTPステータスは、入力不正が`400`、管理トークン不正が`403`、対象なしが`404`、競合・状態不整合が`409`、レート制限が`429`、一時障害が`503`とする。`429`では可能な場合に`Retry-After`ヘッダーを返す。利用者向け文言と再試行方針は`docs/error-catalog.md`を正とする。
