# RV-01 Red Team レビュー

更新日: 2026-07-22
対象: 実装凍結時点のローカルコード（外部 Supabase / Vercel / OneSignal へは接続していない）

## 判定

**FAIL（デプロイ引き継ぎ不可）**。Critical は確認できなかったが、High が複数件未解決である。特に、Vercel の複数インスタンスをまたぐ冪等性がなく、公開 Realtime と未認証の状態取得が攻撃面を作っている。Blue/Purple Teamで修正と再試験が完了するまで、本番反映してはならない。

## 実行した検証

| コマンド | 結果 |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS（production build + 10 tests） |
| `npm run db:validate` | PASS（静的スナップショット 152施設 / 752ストール / seed 152行）。DB接続は未実施 |

追加のローカル再現（テスト用インメモリストアのみ）:

- 未知の `entryId` で `getMyQueue("not-found", "bad")` を呼ぶと、`ENTRY_NOT_FOUND` になるまで **152 トランザクション**を実行した。
- Rate Limit は同一IP・同一施設の9回目を `RATE_LIMITED` にした後、異なる偽 `siteId` を10,001個送るとMap全体をclearし、同じIP・同じ施設の次の参加を許可した。
- Push送信関数を失敗させた場合でも、初回Cron結果は `notifications: 1`、次回は `notifications: 0` となり再送されなかった。
- `idempotent("s", "k", {x:1}, ...)` の後に同じキーで `{x:2}` を渡すと処理が2回実行された（異なるfingerprintを拒否しない）。

## High

### H-01: Idempotency-Key がプロセス内Mapだけで、再送時に待ち列を二重登録できる

- **対象:** `lib/server/idempotency.ts:1-21`, `app/api/queue/join/route.ts:23`, 各 queue mutation route。
- **再現手順:**
  1. 有効な施設に `POST /api/queue/join` を同じ `Idempotency-Key: K` で送る。
  2. 1回目がタイムアウトした直後、別のVercel Functionインスタンス（または別リージョン/コールドインスタンス）へ同じリクエストを再送する。
  3. 両インスタンスは独立した `cache` Map を持つため、両方が `joinQueue()` を実行し、2つの `queue_entries` と2つの管理トークンを作る。`start/duration/extend/complete/cancel` も同じ制約を受ける。
- **証跡:** 実装コメント自身が「same server instance」だけの重複防止であることを明記している（`idempotency.ts:1-4`）。DBにIdempotency-Keyの一意制約・結果保存・claimが存在しない。fingerprint不一致時も409等にせず上書き実行する（`idempotency.ts:16-19`）。
- **影響:** 参加人数、FIFO、スロット割当、Push回数が壊れる。レスポンス消失時の正しい再送というAPI要件を満たさず、利用者が実際に2番を取得する。
- **修正要求:** scope + key の一意な永続claim（または同じ施設トランザクション内の一意なリクエスト記録）を設ける。fingerprintをハッシュ化して同一キーの異なるbodyは409で拒否し、既存の結果を全インスタンスから返す。Pushの副作用もclaimと同じトランザクション/アウトボックスで一度だけ実行できることを再試験する。

### H-02: 未認証の状態取得が全施設を順次ロックし、公開サマリーも `FOR UPDATE` でDoSできる

- **対象:** `app/api/queue/me/route.ts:9-16`, `lib/server/queue-service.ts:156-170,172-199`, `lib/server/db.ts:77-93`, `app/api/sites/[siteId]/summary/route.ts`, `lib/server/queue-service.ts:102-121`。
- **再現手順:**
  1. 任意の非空値を`X-Queue-Token`へ入れ、`GET /api/queue/me?entryId=<ランダムUUID>` を多数並列送信する（ヘッダー自体が空の要求はRoute入口で短絡するが、推測困難なID/トークンの組み合わせは誰でも生成できる）。未知IDなら認証成功前に全施設走査へ進む。
  2. `getMyQueue()` は `listSites()` で全施設を読み、各施設について `transaction()` を実行する。Postgres実装では各トランザクションが施設行、全slot、全queue rowを `SELECT ... FOR UPDATE` する。
  3. ローカル再現では152施設構成に対し、1回の未知IDで152トランザクションになった。DB Poolは`max: 8`（`db.ts:63`）なので、並列攻撃で正規のjoin/complete/Cronが待たされる。
  4. さらに公開 `GET /api/sites/:siteId/summary` は読み取りなのに同じロックトランザクションを取得するため、1施設への連続リクエストでもその施設の状態変更を待たせられる。
- **証跡:** `getMyQueue`/`mutateEntry` にエントリーIDのUUID検証も単一SQL検索もなく、全施設走査が固定実装されている（`queue-service.ts:156-198`）。`PostgresQueueStore.transaction` のSQLは3箇所すべて `FOR UPDATE`（`db.ts:81-92`）。このAPI群にはIP/施設単位のレート制限がない。
- **影響:** 未認証の第三者が、管理トークンを知らなくてもDB接続、ロック、CPUを消費し、待ち列操作を遅延/タイムアウトさせる。多数の正規利用者が同時にいる施設ほど影響が大きい。
- **修正要求:** `entryId`をUUIDとして早期検証し、エントリーを `WHERE id = $1` の単一クエリで引く（必要な施設IDだけをロック）。本人取得は読み取り専用分離レベル/通常SELECTにして、状態変更だけが `FOR UPDATE` を使う。公開summaryもread-onlyトランザクションにし、edge/WAFまたは分散Rate Limit、接続・クエリ上限、429を追加する。未知IDの攻撃テストを152施設・同時100以上で実行する。

### H-03: 公開Realtimeイベントのversion検証・デバウンスがなく、攻撃者のBroadcastで全接続をGET増幅できる

- **対象:** `lib/client/realtime.ts:16-50`, `app/page.tsx:271-277`, `lib/server/realtime.ts:9-39`。
- **再現手順:**
  1. 仕様どおり公開channelを利用しているSupabase Realtimeへ、公開publishable keyで `site:<対象UUID>` の`queue_changed`イベントを大量送信する（サーバーはpublic Broadcastであることを前提にする）。
  2. クライアントはtopicの一致、現在の`queueVersion`より新しいか、イベント間隔を確認せず、`siteId`一致と`Number.isSafeInteger(queueVersion)`だけで `onChange()` を呼ぶ（`realtime.ts:41-46`）。負数や古いversionも通る。
  3. 待機中の各画面はイベントごとに管理トークン付き `GET /api/queue/me` を実行し、施設詳細画面はsummary GETを実行する（`page.tsx:273-276`）。
- **証跡:** `docs/realtime-spec.md` は「現在値より新しい場合だけ再取得」と定義しているが、その比較値が実装にない。クライアント接続時にpublishable keyをURLと`access_token`へ渡し（`realtime.ts:21,38`）、サーバーBroadcastも公開キーだけでREST送信している（`realtime.ts:18-35`）。
- **影響:** 1つの攻撃イベントが同じ施設の全利用者へ増幅され、DB Pool/ロックを枯渇させる。古いversionを再送するだけでも同様で、正規の待ち列操作が遅延する。個人情報はpayloadにないが、可用性とトークン付きAPIの負荷が破壊される。
- **修正要求:** topic/UUID/`queueVersion >= 0` を厳格に検証し、画面が保持する最新versionより大きい時だけ一度再取得する。イベントを短時間にcoalesce/debounceし、最低poll間隔を設ける。公開channelのpublish権限をSupabase側で制限するか、サーバー中継・署名付き更新信号へ切り替える。攻撃者がversionを単調増加させても無限GETにならない上限をE2Eで確認する。

### H-04: 参加抑止（Rate Limit/CAPTCHA）が本番で容易に無効化・回避できる

- **対象:** `lib/server/rate-limit.ts:5-23`, `app/api/queue/join/route.ts:12-14`, `lib/server/turnstile.ts:3-16`。
- **再現手順（Rate Limit）:**
  1. 同一IP・同一施設で8回呼ぶと9回目が429になる。
  2. その後、bodyの`siteId`を無関係な文字列へ変えたリクエストを10,001個送る。Mapの容量上限到達時に `counters.clear()` が全キーを消すため、元のIP・元の施設の次の参加が再び許可される。
  3. Vercelの別インスタンスへ振り分ければ、各インスタンスのMapが別なのでこの制限を最初から回避できる。`x-forwarded-for`の先頭値もアプリが受け取ったヘッダーをそのままキーにしている。
- **再現手順（CAPTCHA設定漏れ）:** `TURNSTILE_SECRET_KEY`を未設定にした本番相当プロセスで、tokenなしのjoinを送る。`verifyTurnstile()`は5行目で即returnし、CAPTCHAなしで参加が成功する。公開段階での設定漏れを検知するstartup/health checkがない。
- **証跡:** 実装コメントもこのRate Limitがインスタンス間共有されない「first-line throttle」に過ぎないと認めている（`rate-limit.ts:5-7`）。キーは攻撃者が指定できる`siteId`を含み、上限到達時は全Mapをclearする（同:13-18）。同一ブラウザの既存tokenをサーバー側で確認する処理もなく、重複抑止は画面のlocalStorageに依存する。Turnstileはsecret欠落をエラーにせず無条件bypassする（`turnstile.ts:3-6`）。
- **影響:** CAPTCHAを有効化したつもりでも、設定漏れや段階的デプロイでBot大量参加が可能になる。複数インスタンス/偽IP/Map clearで施設単位の荒らしを抑えられず、FIFOと容量を枯らす。
- **修正要求:** 公開運用ではsecret欠落を`CONFIGURATION_ERROR`としてfail-closedにし、設定済み/無効化を明示的な環境フラグで分ける。Rate Limitは信頼できるedgeの実IPを使う分散ストア/WAFへ移し、攻撃者入力（任意siteId、偽XFF）で全体clearしない。IP、施設、fingerprintを組み合わせた上限と、join成功数の監視・アラートを追加する。

## Medium

### M-01: Push送信失敗を「送信済み」として先に確定し、再送も無効Subscription削除もない

- **対象:** `lib/server/queue-service.ts:279-298`, `lib/server/push.ts:25-40`。
- **再現手順:** `setPushSenderForTests(async () => { throw new Error("fail") })` を設定して期限到来のentryを`processQueue()`へ渡す。1回目は送信権をclaimして `notifications: 1`、失敗を握りつぶす。次回Cronは`five_min_push_sent_at`等が既に設定済みなので`notifications: 0`になり、再送されない。
- **証跡/影響:** timestampをDBへcommitするのは外部fetchより前（`queue-service.ts:290-292`）、外部送信はcommit後に一括実行し例外を捨てる（同:298）。OneSignalの4xxも`sendQueuePush()`が`false`を返すだけで、呼出側はSubscription IDを削除しない。要件の「失敗でも画面内を正とする」は満たすが、5分前/順番到来通知を恒久的に失う。
- **修正要求:** 送信claimにlease/attempt状態と再試行上限を設け、OneSignal成功時だけ送信済みにする（同じclaimで重複しないoutbox/ジョブ方式）。無効Subscriptionの4xxを検出してDBの紐付けを削除し、失敗件数を運用監視へ出す。Pushなしでも画面Pollingが継続することを再試験する。

### M-02: CSPが `script-src 'unsafe-inline'` で、localStorageの管理トークンをXSSから十分に隔離できない

- **対象:** `next.config.ts:14-27`。
- **再現手順:** 同一originに将来または依存ライブラリ由来のHTML/script injectionが入った場合、CSPがinline scriptを拒否しないため、`localStorage["supercharge-queue-session"]`を読み出して外部送信するscriptが実行可能になる。
- **証跡/影響:** 技術要件は「厳格なCSPでXSSによるlocalStorage窃取リスクを抑える」ことを求めるが、`script-src`に`'unsafe-inline'`がある。現コードはReactの通常エスケープを使い`dangerouslySetInnerHTML`は見当たらず、直ちに悪用できるsinkは確認できないためMediumとした。管理トークンが盗まれれば対象entryの退出・開始・完了・時間変更が可能になる。
- **修正要求:** nonce/hashベースのCSPへ移行し`unsafe-inline`を削除する。OneSignal/Nextの必要なscriptだけにnonceを付与し、`object-src 'none'`、`upgrade-insecure-requests`等を追加する。CSP違反レポートとXSS回帰テストを追加する。

### M-03: Idempotency cacheが無制限に増え、成功レスポンス（管理トークンを含む）を10分保持する

- **対象:** `lib/server/idempotency.ts:5,13-20`。
- **再現手順:** 成功するjoinへ最大長以下の一意な`Idempotency-Key`を大量送信する。期限切れ削除はリクエスト時だけで、Map容量上限がない。各valueは結果PromiseをTTL 10分保持する。
- **影響:** Vercel Functionのメモリ圧迫・GC遅延・OOMが可能になる。join結果の原文管理トークンも通常のレスポンスTTLより長くヒープに残る。H-01の分散重複とは別に、単一インスタンスへの資源枯渇リスクがある。
- **修正要求:** bounded LRU/最大件数・最大レスポンスサイズを設け、成功結果を全量保持せず永続claimへ移す。IDキーの長さだけでなく、送信元・頻度に対する上限をedgeで設ける。

### M-04: HostヘッダーからOG URLを組み立て、キャッシュ/共有カードのHost Header Injection余地がある

- **対象:** `app/layout.tsx:6-20`。
- **再現手順:** `x-forwarded-host: attacker.example` と `x-forwarded-proto: https` を付けてページを取得し、生成HTMLのOG画像URLを確認する。プロキシがこの値を検証せず転送し、CDNがHTMLをキャッシュすると、共有カードが攻撃者ドメインを指すレスポンスを他利用者へ配布し得る。
- **影響:** フィッシング/ブランド偽装、キャッシュ汚染。管理トークンそのものはOGへ含まれない。
- **修正要求:** `NEXT_PUBLIC_APP_URL`等の許可済みcanonical originを使い、`Host`/`X-Forwarded-*`を直接HTMLへ反映しない。複数環境はallowlistで切り替える。

### M-05: Cronが外部Pushをトランザクション後に送るため、取消・完了直後にも古い通知が届く

- **対象:** `lib/server/queue-service.ts:275-298`。
- **再現手順:**
  1. 5分前通知対象をCronで処理し、DBトランザクションをcommitした直後（`pushes`へ積まれた状態）に、同じentryの`cancel`または`complete`を実行する。
  2. その後Cronの`Promise.all(pushes.map(...))`がOneSignalへ送信する。
- **証跡/影響:** Push claim/送信予定はcommit時に保存されるが、送信前の外部キューを取消側が取り消す仕組みはない。取消後に「順番の約5分前」「順番です」等の古い通知が届き、利用者の状態認識を誤らせる。Subscription ID自体はDBから削除されても、既にローカル配列へコピーされた値は送信される。
- **修正要求:** PushをDB outboxとしてclaimし、送信直前にentryの存在・claim lease・状態を再確認する。取消/完了は未送信outboxを失効させる。外部送信の再試行と同時に、削除後の通知が発生しない競合テストを追加する。

## Low / 契約・検証不足

- `parseJson()` は`UNEXPECTED_ERROR`に契約外の「入力を確認してください。」を直接設定する（`lib/server/errors.ts:64-74`）。Cron未認証時も`UNEXPECTED_ERROR`に`"Forbidden"`を渡す（`app/api/cron/process-queue/route.ts:8-10`）。エラーコード・文言を`error-catalog.md`へ限定する要件に反するため、契約テストを追加する。
- `entryId`、`siteId`、`subscriptionId`のUUID/文字種をRoute Handler入口で検証していない。SQL注入はパラメータ化で防がれているが、未知値の全施設走査（H-02）やOneSignal APIへの不正ID入力を招くため、明示的な形式検証を追加する。
- `Strict-Transport-Security`がアプリヘッダーにない。VercelのHTTPS設定に依存するためLowだが、公開本番はHSTS preload可否を運営者が確認する。
- 320/360/390/430px、横向き、キーボード表示の視覚E2Eはこのリポジトリの`npm test`には含まれない。CSS上のレスポンシブ指定は存在するが、CTAの表示欠け・モーダルのsafe-areaを実ブラウザでPASS判定していない。

## 要件別チェック結果

| 確認項目 | 結果 | 根拠 / 残課題 |
|---|---|---|
| 管理トークン偽造/漏えい | 部分PASS | 32-byte乱数、SHA-256、`timingSafeEqual`、トークンURL非使用は良好（`token.ts`）。ただしH-01、M-02で重複・XSS時の影響が残る。 |
| 未認証API | FAIL | 公開sites/summaryは仕様上必要だが、H-02の未認証ロックDoSを修正要。Cronはsecret不在時deny。 |
| RLS/DBトランザクション | 条件付きPASS | migrationで3表RLS有効、anon権限revoke、施設/slot/entryをロックする設計は確認。Supabase Cloudでの実権限は未接続のため運営者確認が必要。 |
| 同時join/complete | 条件付きPASS | 施設行`FOR UPDATE`で直列化される実装。真のPostgres並行E2Eは未実行、H-01の分散再送は別途FAIL。 |
| Cron冪等性/期限境界 | 部分PASS | 削除・送信時刻・行ロックの条件はある。M-01のPush失敗時再送不可。ドメインの呼出/完了/延長境界単体テストはPASS。 |
| Idempotency-Key | FAIL | H-01。永続化なし、fingerprint競合拒否なし。 |
| Rate Limit/CAPTCHA | FAIL | H-04。インメモリ、任意siteId/XFF、Map全消去、secret欠落fail-open。 |
| Realtime payload | 部分PASS | サーバーpayloadは`siteId`/`queueVersion`のみで個人情報なし。クライアントの新旧比較・debounceなし（H-03）。 |
| OneSignal本文/秘密 | PASS（失敗処理はFAIL） | 本文は固定行動案内と施設名のみ、REST keyはserver-only。M-01の送信失敗/無効ID処理を修正要。 |
| CSP/クライアント秘密露出 | 部分PASS | server-only env名はclient bundleへ露出していないことをローカルbuildで確認。`unsafe-inline`はM-02。 |
| 入力検証/XSS | 部分PASS | nicknameはNFKC/1-30/control除去、React表示はエスケープ。UUID/body上限/Subscription形式検証が不足。 |
| ブラウザストレージ消去 | PASS（通常経路） | complete/cancel/expired/recoveryでsession/localの両方を削除。Storage API例外時は削除不能だがPrivate mode想定の案内あり。 |
| レスポンシブCTA | 未判定 | 静的CSSは指定幅を考慮するが、実ブラウザ視覚E2E証跡なし。 |
| 任意時間変更禁止 | PASS | 初回確定後は`DURATION_ALREADY_CONFIRMED`、延長は終了予定-3〜+5分の窓でのみ許可。 |

## Red Team結論

通常の単体/ビルド試験は通過しているが、公開API・公開Realtime・Vercelの分散実行を前提にした攻撃試験でHighが残る。H-01〜H-04を修正し、M-01〜M-05を受容または修正したうえで、Postgres同時実行、別Function再送、public Broadcast spam、未知entryIdの負荷、Push失敗回復、取消とPush送信の競合を再実行するまで**FAIL**とする。
