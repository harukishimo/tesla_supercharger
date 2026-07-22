# RV-02 Blue Team レビュー

更新日: 2026-07-22

対象は、ローカル共有ワークスペースの再レビュー時点の現行コード、正本資料、および `docs/reviews/red-team.md` の指摘である。Supabase、Vercel、OneSignal、Turnstileへは接続していない。コードの変更は行わず、レビュー記録だけを更新した。

## 判定

**条件付き FAIL（本番引き継ぎ不可）**。

Critical は確認できなかった。今回、UUID早期検証、summaryと本人取得のread-only化、Realtimeのversion/coalesce、production CAPTCHA fail-closed、Rate Limitのbounded eviction、DB上の冪等ハッシュ、操作body単位のUIキー再利用、Push失敗時claim解放、HSTS、成功済みresponseの即時cache削除は確認できた。純粋ドメイン計算、管理トークンのハッシュ照合、Postgresトランザクションの施設ロック、RLS設計も良好である。一方、参加Rate Limitの分散性、公開Realtimeの負荷増幅、および削除後の冪等成功response claim・Push運用上の残余が未解決であり、公開運用を承認できない。

## 検証コマンド

| コマンド | 結果 | 備考 |
|---|---|---|
| `npm run lint` | PASS | 警告・エラーなし。 |
| `npm run typecheck` | PASS | build後の再実行でTypeScriptエラーなし（並列実行時の `.next/types` 欠落は再生成で解消）。 |
| `npm test` | PASS | production build + 11 testsがPASS。 |
| `npm run db:validate` | PASS | 静的snapshot 152施設 / 752ストール / seed 152行。DB applyは未実施。 |

テストはローカルのInMemoryQueueStoreを含む決定論的テストであり、実Postgresの同時実行・RLS・接続プール・外部Pushの到達性を証明するものではない。

## Critical

確認なし。

## 解消確認（旧High）

### H-01（解消確認）: 操作body単位の冪等キー再利用

`queue_entries`へ参加キー/fingerprintと最後のmutationキー/fingerprint/時刻をSHA-256で保存し、施設行ロック下で照合するため、同一キーを別Vercel Functionへ再送しても、entryが残る間はjoin/mutationの二重状態変更を抑止できる。参加tokenもserver-only HMACから決定的に復元される。fingerprint違いを `IDEMPOTENCY_KEY_REUSED` で拒否する改善も確認した。

UIの `join` / `mutate` は操作body（operation、site/entry、入力値）からfingerprintを作り、通信失敗中は同一fingerprintに同じ `Idempotency-Key` を保持し、成功時だけ破棄する実装へ更新された。DBの参加/最後のmutation hashと施設行ロックの照合により、entry存続中の別Function再送・body違い拒否を確認でき、当初の「再試行ごとに新UUIDでjoinが二重登録される」指摘は解消と判定する。

残余としてcancel/complete成功後はentryとhashが削除されるため、成功responseを受け取れなかった再送は `ENTRY_NOT_FOUND` になる。二重削除は起きないが、削除後も同じ成功結果を返す完全な冪等契約ではないため、Purpleで通信断後の再送を確認し、必要なら結果claim/outboxを追加する（Highからは除外）。

## High（未解決）

### H-02: 参加Rate Limitは分散されず、送信元IPヘッダーを信頼している

`lib/server/rate-limit.ts` はインスタンス内Mapであり、同一IP・施設の8回制限と上限10,000件のbounded evictionを行う。Map全消去は改善された。join routeの参照順は `cf-connecting-ip` → `x-real-ip` → `x-forwarded-for` へ改善されたが、これらの値をedgeが検証・上書きしない構成では、偽IPを毎回送って施設荒らしを回避できる。複数インスタンス間でもMapは共有されない。Turnstileは本番でsecret未設定を `CONFIGURATION_ERROR` とするfail-closedへ改善されているため、Red Team時点の「secret欠落fail-open」は解消済み。

信頼できるedge/WAFの実IP、分散Rate Limit、施設・IP・指紋を組み合わせた上限、成功参加数の監視が必要。

### H-03（解消確認）: 本人状態取得の不要な行ロック

未知 `entryId` の全152施設走査は `QueueStore.lookupEntry` の単一SQLへ改善され、`getMyQueue()` の再確認 transaction も明示的に `{ lock: false }` を渡す実装へ更新された（`lib/server/queue-service.ts:175-180`）。`GET /api/sites/:siteId/summary` も非ロックであり、read GETが施設・slot・queue rowを `FOR UPDATE` してjoin/complete/Cronを待たせる経路は解消と判定する。

実Postgresでread-only transactionのロック待ちが発生しないこと、接続・クエリ上限と同一entry/施設単位のGET rate limitはPurpleで負荷検証する（Highからは除外）。

### H-04: 公開Realtime Broadcastの書込権限による負荷増幅が残る

クライアントはtopic/siteIdを一致確認し、`queueVersion > 0`、現在versionより新しいことを検証し、1秒間にcoalesceする改善が入っている。サーバーpayloadは `siteId` と `queueVersion` のみで個人情報を含まない。一方、公開channelへpublishする権限を攻撃者が持つ構成は変わらず、単調増加versionを送れば各接続が最大おおむね1秒1回のtoken付き `GET /api/queue/me` またはsummaryを行う。利用者数が多い施設ではサーバー・DB負荷を増幅できる。

Supabase側のpublish制御、署名済みサーバー中継、接続ごとのイベント上限を検討し、100接続・大量Broadcastの負荷試験でGET上限を確認する。

## Medium

### M-01: Push失敗claim解放は改善されたが、無効Subscriptionの削除がない

`processQueue()` はトランザクション内で通知claimを設定してからcommit後にOneSignal送信を行うが、送信失敗・timeout時はclaimを再取得して同じ時刻なら解放する改善が入った。次回Cronで再試行できる。一方、OneSignalの無効Subscription 4xxを成功/無効として区別せずclaim解放するため、無効IDが残り、毎回のCronで再試行され得る。画面内状態を正とするため待ち列自体は失効しないが、通知運用のノイズと監視負荷が残る。

送信claim lease/outbox、成功時のみ確定する状態、再試行上限、無効Subscription削除、取消・完了との競合を設計する。

### M-02: 取消・完了直後に、commit済みPushが遅れて届き得る

CronはPushのSubscription IDをローカル配列へコピーしてから外部送信する。並行するcancel/completeがDB行と紐付けを削除しても、その配列の通知は送信される。古い「順番です」「あと5分」通知が届く競合が残る。

送信直前のentry存在・claim lease・status再確認、未送信outboxの失効、競合テストが必要。

### M-03: CSPに `script-src 'unsafe-inline'` が残る

`next.config.ts` は `script-src 'self' 'unsafe-inline' ...`、`style-src`にも `unsafe-inline` を許可している。現コードに明らかなHTML/JS sinkは確認できず、Reactの通常エスケープも使っているため直ちにCriticalではない。しかしlocalStorageの管理トークンをXSSから隔離するという要件には不十分である。nonce/hash方式へ移行し、OneSignal/Turnstileに必要なscriptだけを許可すること。

### M-04（解消確認）: 成功済みIdempotency responseのメモリ保持

成功時にプロセス内cacheを即時削除し、active entryの永続hashをsource of truthにする変更を確認した。以前の「join成功tokenをTTL中保持する」リスクは解消。H-01の削除後claimは別の契約残課題である。

## Low / 契約・運用上の残課題

- `IDEMPOTENCY_KEY_REUSED`、`CONFIGURATION_ERROR`、JSON不正時の応答などが `docs/error-catalog.md` の固定code/文言一覧と完全一致するか、契約テストがない。Cron未認証は `UNEXPECTED_ERROR` + `Forbidden`（403）で返るため、公開API契約との整合を明文化する。
- lintは再レビューで警告・エラーなくPASSした。
- migrationはRLSを有効化し、public/anon/authenticatedから3表の権限をrevokeしている。`npm run db:validate` は静的検査のみで、Supabase CloudのRLS実効権限、DB接続ロール、migration適用後の `anon` SELECT/UPDATE拒否を未確認。
- `Strict-Transport-Security` は `max-age=31536000; includeSubDomains; preload` として追加確認できた。preload登録・HTTPS強制は公開originで運用確認する。
- nickname/duration/siteId/entryIdの主要入力検証とserver-only secretの分離は確認できる。Push subscription IDは長さ上限のみで、外部SDKの許容文字種・失効応答の検証を追加するとよい。
- `SUPABASE_DATABASE_URL`、OneSignal REST key、Turnstile secret、Cron secretの実値をログ・URL・Push本文へ含めない実装は確認できる。外部サービスへの実接続、秘密値のローテーション、障害時の監視は未実施。
- Postgres Poolは接続URLのSSL指定に依存している。運用者はSupabaseの `sslmode=require` を含むURLだけを登録し、平文接続を拒否することを引き継ぎ条件にする。

## 要件別チェック

| 項目 | 判定 | 根拠 / 残課題 |
|---|---|---|
| RLS / ブラウザ直アクセス禁止 | 条件付きPASS | RLS + revokeをmigrationで確認。実DBでanon/authenticatedの拒否を未確認。 |
| 入力検証 | 部分PASS | UUID、nickname NFKC/1〜30/control除去、duration 5〜120、production CAPTCHA fail-closed。JSON body上限・Push ID形式・契約外errorの確認が残る。 |
| 管理トークン | 条件付きPASS | 32-byte乱数、SHA-256、timing-safe照合、URL/Push非包含。XSS/CSPと分散再送が残る。 |
| 同時操作 / transaction | 条件付きPASS | Pg adapterはfacility/slot/entry `FOR UPDATE`、BEGIN/COMMIT/ROLLBACK。本人取得とsummaryのread-only transactionは `lock:false`。実Postgres同時E2E未実施。 |
| Cron | 部分PASS | CRON_SECRET検証、期限境界の単体テストあり。Push失敗・取消競合と実Vercel重複未検証。 |
| Push | 部分PASS | secret server-only、本文は施設名と行動案内のみ、Pushなしでも操作可能。失敗claim解放は確認、無効ID削除と取消競合は未解決。 |
| Realtime | 部分PASS | payloadはsite/versionのみ、clientの新version検証とcoalesceあり。public publish負荷増幅が残る。 |
| Idempotency | 部分PASS | DB上の参加/最後のmutation hashと操作body単位のUIキー再利用で、entry存続中の別Function再送・body違いを抑止。削除後の結果claimなしは契約残課題。 |
| Rate Limit / CAPTCHA | FAIL | CAPTCHA production fail-closedはPASS、Rate Limitはインスタンス内・untrusted forwarded IP。 |
| CSP / secret exposure | 部分PASS | server-only env値はbuild成果物に露出していないことを確認。`unsafe-inline`は残存。 |

## 運用引き継ぎ

本番前に、(1) `SUPABASE_DATABASE_URL` はDB専用のserver-side secretとして設定し、(2) `CRON_SECRET`をVercel Cronに設定、(3) Turnstileを公開運用では必ず設定、(4) OneSignal Preview/Production App ID・REST keyを分離、(5) Supabase RLSとRealtime publish policyを実DBで確認、(6) 監視へ429、503、Push失敗、Cron遅延、DB lock waitを送ること。ログ・監視にはnickname、token、Push subscription ID、DB URLを記録しない。

## Purple Teamで再確認する項目

1. 2つのPostgres接続/Functionから同じ `Idempotency-Key` のjoinを同時実行し、queue entryが1行・tokenが1つになること、body違いが契約済み409になること。
2. 同一施設への `GET /api/queue/me` 100並列、summary 100並列とjoin/completeを混在させ、read-only GETがwrite lockを保持しないこと（H-03解消の回帰）、429/timeout上限を確認すること。
3. 複数Vercelインスタンス、偽XFF、異なるsiteIdでRate Limitを回避できないこと。edge/WAFの実IP受け渡しとTurnstile secret欠落のfail-closedを確認すること。
4. public Broadcastへ古いversion・単調増加version・不正topicを大量送信し、client coalesce後のGET増幅、Supabase publish policy、利用者画面のPolling fallbackを測定すること。
5. OneSignal 5xx/timeout/4xx、Cron重複、cancel/completeと送信の同時実行を再現し、再試行・無効Subscription削除・古い通知抑止を確認すること。
6. `320/360/390/430px`、横向き、キーボード、Realtime切断、Push拒否を実ブラウザで確認し、CSP nonce/hash、HSTS、Host header固定originの回帰試験を実施すること。
7. 実DBでanon/authenticated/publicの3表 SELECT/INSERT/UPDATE/DELETE拒否、server roleの必要操作だけ許可、migration/seed再実行・FK・queue_version整合を確認すること。
8. 呼出5分境界、予定終了+5分、自動完了、3分前延長、同時空き・同時完了・Cron重複のPostgres E2E証跡を保存すること。

## 最終判定

ローカルのbuild/typecheck/test/db静的検証は通過した。H-01（UIキー再生成）とH-03（本人GETロック）は解消確認、M-04も解消確認できた一方、High 2件（H-02、H-04）とMedium 3件（M-01〜M-03）が残るため、Blue Teamとして**FAIL**。分散Rate Limitと公開Realtime負荷を修正または運用上の防御で閉じ、削除後冪等claim・Push障害・RLS実DBを含むPurple Team試験をPASSしてから実装凍結・本番反映へ進める。
