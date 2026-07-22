# RV-03 Purple Team レビュー

更新日: 2026-07-22

対象は、Red Team（RV-01）および Blue Team（RV-02）を反映した現行ワークツリーと正本資料である。外部 Supabase / Vercel / OneSignal / Turnstile には接続していない。Purple Teamの所有変更は本レビュー記録だけで、アプリコード・migration・seedは変更していない。

## 検証コマンド

指定順で次を実行した。

| コマンド | 結果 | 確認内容 |
|---|---|---|
| `npm run lint` | PASS | ESLintの警告・エラーなし。 |
| `npm run typecheck` | PASS | TypeScript型検査成功。 |
| `npm test` | PASS | production build成功、11テスト（ドメイン、サービス、Route Handler、UI/PWA構成）成功。 |
| `npm run db:validate` | PASS（静的） | 152施設、752ストール、seed 152行。`DATABASE_URL`未設定のためDB applyは未実施。 |
| `git diff --check` | PASS | whitespaceエラーなし。 |

追加静的確認: client static chunkの秘密環境変数名スキャンはPASS。`app/layout.tsx` / `app/page.tsx`のTurnstile script、widget、callback、token送信参照を`rg`で確認した。

build成果物のclient static chunkを検索し、`SUPABASE_DATABASE_URL`、`ONESIGNAL_REST_API_KEY`、`TURNSTILE_SECRET_KEY`、`CRON_SECRET`、`QUEUE_IDEMPOTENCY_SECRET`の秘密環境変数名がclient bundleへ出ていないことを確認した。公開値である`NEXT_PUBLIC_*`の埋め込みは想定どおりである。

## Red / Blue の突合

### 解消を確認した指摘

- 未知の`entryId`をRoute Handler入口でUUID検証し、`lookupEntry`の単一検索後に対象施設だけを読む構造へ変更されている。
- `getMyQueue`と`getSiteSummary`は`transaction(..., { lock: false })`で読み取り専用になっている。状態変更だけが施設・slot・queue rowのロックを取得する。
- 参加キー/fingerprint、最後のmutationキー/fingerprintを`queue_entries`へハッシュで保存し、施設トランザクション内で照合している。同一キーのbody違いは`IDEMPOTENCY_KEY_REUSED`（409）になる。参加tokenは本番のserver-only HMACから再現され、idempotency成功レスポンスはプロセスcacheから即時削除される。Turnstile tokenはfingerprint対象外で、active replayはCAPTCHA検証より先に返す。
- UIのjoin/mutationはoperationとbody単位のキーを通信失敗中に再利用し、成功時にだけ破棄する。旧Red H-01の「毎回新UUIDで二重参加」は、entryが有効な範囲では解消と判定する。
- Realtimeは`siteId`一致、正の安全な`queueVersion`、保持中のversionより新しいことを検証し、1秒以内のイベントをcoalesceする。切断・未設定時は10〜15秒pollingへフォールバックする。
- 本番で`TURNSTILE_SECRET_KEY`が欠落した場合はfail-closedで`CONFIGURATION_ERROR`となる。Rate Limit Mapは上限付きで、旧実装の全Map消去はない。
- Turnstileは`NEXT_PUBLIC_TURNSTILE_SITE_KEY`設定時にlayoutからexplicit API scriptを読み込み、参加画面と満車確認画面で`TurnstileWidget`をrenderする。callbackのtokenをjoin bodyへ渡し、expired/error時はtokenを消去して参加CTAを無効化するため、旧H-03（production secret設定時にUIからjoin不能）は解消と判定する。実Siteverify接続は外部サービス引継ぎ条件である。
- Push送信失敗時は同じclaim時刻だけを解放し、次回Cronで再試行できる。`NEXT_PUBLIC_APP_URL`をcanonical originとしてOG URLを組み立て、Host header injectionの旧指摘を解消している。HSTSも設定済みである。

### High指摘の突合（残存 / 解消）

#### H-01: 参加Rate Limitは分散されず、信頼される実IPの境界がコードで固定されていない

`app/api/queue/join/route.ts`は`cf-connecting-ip`、`x-real-ip`、`x-forwarded-for`を順に受け取り、`lib/server/rate-limit.ts`のプロセス内Mapへ渡す。Vercel/Cloudflare等のedgeがこれらを上書き・検証する保証はコードにない。

再現は、実在するUUIDの施設に対して、毎回異なる`cf-connecting-ip`（またはedgeが未設定の`x-forwarded-for`）を付けて9回以上joinすること。各キーは別counterとなり、同一送信元の8回制限を回避できる。さらに別Vercel FunctionインスタンスではMap自体が共有されない。10,000件上限のbounded evictionはメモリ保護であり、分散Rate Limitの代替ではない。

影響はBotによるFIFO荒らし、容量消費、待ち時間計算の破壊である。信頼できるedge実IP、分散ストア/WAF、施設・IP・指紋を組み合わせた制限と監視が本番前提となる。

#### H-02: 公開Realtime Broadcastは、攻撃者の単調version送信でGETを増幅できる

仕様上のpublic channelを利用し、`lib/client/realtime.ts`は新しい`queueVersion`を受けると、coalesce後に待機中ならtoken付き`GET /api/queue/me`、詳細画面ならsummary GETを実行する。publish権限をSupabase側で制限する署名、サーバー中継、接続ごとのイベント上限はコードにない。

再現は、public channelへ対象施設の`queue_changed`を単調増加versionで大量送信し、100接続程度のブラウザを観測すること。クライアント側の1秒coalesceは1接続あたりの増幅を緩和するが、接続数×毎秒GETを残すため、DB PoolとRoute Handlerを枯渇させ得る。外部Realtimeへ接続しての負荷実証は未実施だが、公開publish権限を前提とする設計上のHighである。

#### H-03（解消確認）: production CAPTCHA設定時のUI結線

`lib/server/turnstile.ts`はproductionでsecret未設定ならfail-closedし、secret設定時はtokenを必須にする。現行UIは`app/layout.tsx`で`NEXT_PUBLIC_TURNSTILE_SITE_KEY`設定時だけ`https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`を読み込み、`app/page.tsx`の`TurnstileWidget`が`render`/`callback`/`expired-callback`/`error-callback`を実装している。JoinScreenとFullConfirmScreenのCTAはsite key設定時にtokenがなければdisabledで、取得tokenは`join()`のbodyの`turnstileToken`へ渡される。`rg`でscript、widget、token、site keyの全結線を確認したため、旧H-03は解消と判定する。

実Cloudflare Siteverify、正しいSite/Secretの組合せ、CAPTCHA成功・期限切れ・拒否のブラウザ実証は外部サービス引継ぎ条件に残す。Site keyだけ、またはSecretだけを設定した不整合構成ではjoinできないため、運営者は両値を同一環境へ設定する。

## Medium / Lowの残課題

- **Push失敗運用:** 失敗claimは解放されるが、OneSignalの無効Subscription（4xx）を削除せず、毎回Cronで再試行し続ける。通知claimをoutbox/lease化し、無効ID削除と試行上限が必要。
- **取消・完了とPushの競合:** Cronがcommit後にローカル配列のSubscriptionへ送信するため、並行cancel/complete後にも古い通知が届き得る。送信直前のentry/claim再確認または未送信outbox失効が必要。
- **CSP:** `script-src`と`style-src`に`'unsafe-inline'`が残り、localStorageの管理tokenをXSSから十分に隔離できない。Nonce/hashへ移行するまで条件付きである。
- **GET負荷上限:** `queue/me`と公開summaryはread-only（`FOR UPDATE`なし）へ修正済みだが、IP/施設単位のGETレート制限は実装していない。読み取りロックDoSは解消した一方、接続Pool・クエリ上限はedge/WAFと運用監視で制御し、100並列の実Postgres負荷証跡を保存する。
- **Turnstile再送と冪等性（修正確認）:** join routeは施設ロック下でactive idempotency claimを先に照合し、既存ならsingle-use tokenを再検証せず決定的tokenを返す。新規時だけ`verifyTurnstile`後にinsertする。UIのjoin fingerprintから`turnstileToken`を除外し、token更新・再送でも同じ操作キーを再利用する構造へ修正された。静的コード突合はPASS。実Siteverifyのsingle-use挙動と通信断後の再送は運営者E2Eで確認する。
- **削除後の冪等結果:** cancel/complete成功後はactive entryとhashを削除するため、レスポンス消失後の同一キー再送は`ENTRY_NOT_FOUND`になる。二重削除はないが、成功結果claimを保持する完全な冪等契約ではない。
- **mutation claimの保持範囲:** `queue_entries`へ保持するmutation key/fingerprintは最後の1件だけで、10分窓を超えるか別mutationが先に成功すると過去キーは再実行経路へ入る。状態guardで拒否される操作が多いが、全操作の結果claimを保証するものではない。
- **Realtime topic連携:** server側のBroadcast topicは`site:<id>`、client側のWebSocket join topicは`realtime:site:<id>`で表記が異なる。Supabaseの実環境で同一channelとして解決されるか未確認で、失敗時はpollingが救済するがRealtime要件の実証になっていない。
- **入力上限:** JSON body全体のサイズ上限やPush Subscription IDの文字種検証はない。Route Handlerの上流制限とSDK仕様に合わせた形式検証が必要である。

## 必須受入条件の確認

| 条件 | 判定 | 根拠 / 引き継ぎ条件 |
|---|---|---|
| API・ドメイン・ビルドのローカル検証 | PASS | 上記5コマンド、11テスト。 |
| 152施設 / 752ストール | 条件付きPASS | 静的seed検証PASS。実DBへのmigration/RLS適用は未実施。 |
| 管理token、UUID、read-only取得、冪等 | 条件付きPASS | 静的実装と単体/Routeテスト。Postgres別Function同時実行は未実施。 |
| Rate Limit / CAPTCHA | FAIL | CAPTCHAのproduction UI結線とfail-closedは解消確認。Rate Limitは分散されずuntrusted forwarded IPを信頼するためFAIL。実Cloudflare Siteverifyは運営者引継ぎ。 |
| Realtime | FAIL | version/coalesceはPASSだが公開publish負荷増幅とtopic連携を実環境で閉じていない。 |
| Push | 条件付きPASS | 失敗再試行は確認。外部4xx、cancel競合、実配信は未実施。 |
| PWA / 利用規約導線 | 条件付きPASS | manifest、同一origin Worker、`/terms`、`/privacy`と参加画面リンクを静的確認。実iOS/Android Pushは未実施。 |
| 320/360/390/430px視覚E2E | 未判定 | CSSはfluid/max-widthを持つが、指定幅・横向き・キーボード・safe-areaの実ブラウザ撮影証跡なし。 |

## 最終判定

**FAIL（デプロイ引き継ぎ不可）**。

Criticalは確認しなかった。H-03（production Turnstile UI結線欠落）は解消確認できたが、High 2件（分散Rate Limit、公開Realtime負荷増幅）が残るため、Master Promptの「すべての必須受入条件がPASSの場合のみデプロイ引き継ぎ可」を満たさない。Turnstile自体は、Site/Secretの正しい設定と実Siteverifyを運営者引継ぎ条件として確認する。

## 運営者引き継ぎ条件（Purpleが実施していないもの）

- Supabaseへmigration/seedを適用し、152施設・752ストール・752仮想slot、RLS、匿名直接操作拒否、Realtime publish policyを実DBで確認する。
- Vercelの信頼できるedge実IP、分散Rate Limit/WAF、`CRON_SECRET`、`QUEUE_IDEMPOTENCY_SECRET`、`SUPABASE_DATABASE_URL`（`sslmode=require`）を設定する。値はこの報告に記載しない。
- OneSignal Preview/Production App ID・REST API Key、同一origin Worker、Turnstile Site/Secret、HTTPS canonical originを設定し、実Push/失敗/無効Subscription/取消競合を検証する。
- Turnstile Site/Secretを同一環境へ設定し、widget表示、token取得、Siteverify成功・期限切れ・拒否、公開joinのスモークテストを行う（UI結線はPurpleで解消確認済み）。
- Playwright等で320/360/390/430px、縦横、キーボード、Realtime切断・再接続、Push拒否、モーダルfocus trap、CTA欠けを撮影し、実Postgresの同時join/complete/Cron重複負荷証跡を保存する。
