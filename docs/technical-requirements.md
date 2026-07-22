# スパQ 技術要件書

## 1. 文書情報

| 項目 | 内容 |
|---|---|
| 文書名 | スパQ 技術要件書 |
| 対象 | MVP（Webアプリ） |
| ステータス | Draft 1.5 |
| 作成日 | 2026-07-22 |
| 関連文書 | `docs/requirements-definition.md`、`docs/error-catalog.md`、`docs/database-schema.md` |

## 2. 技術方針

### 2.1 結論

MVPはVercel + Supabaseを採用し、利用者・運用者ともにログイン機能を実装しない。

| レイヤー | 採用技術 | 主な責務 |
|---|---|---|
| フロントエンド | Next.js App Router + TypeScript | 高速施設検索、待ち列UI、部分更新 |
| ホスティング | Vercel | Next.js配信、Preview、HTTPS |
| データベース | Supabase Postgres | 施設、仮想ストール、有効な待ち列だけを保持 |
| 利用者認証 | 使用しない | Supabase Anonymous Sign-In、Phone Loginとも不使用 |
| 待ち列所有確認 | 待ち列単位の管理トークン | アカウントを作らず本人の操作を確認 |
| DB保護 | RLS + Next.js Route Handlers | ブラウザから待ち列テーブルを直接操作させない |
| リアルタイム | Supabase Realtime Broadcast | 内部更新イベントの受信後に状態を再取得し、React stateだけ更新 |
| 業務ロジック | Next.jsサーバー側TypeScript | FIFO、状態遷移、待ち時間再計算 |
| HTTP処理 | Next.js Route Handlers | 管理トークン検証、Push送信、DB更新 |
| 定期処理 | 無料外部スケジューラー + Route Handler | 順番5分前判定、終了3分前確認、呼び出し失効、自動整理 |
| 通知 | OneSignal Web Push | 匿名ブラウザSubscriptionへの順番5分前・順番・終了3分前確認通知 |
| Bot対策 | Cloudflare Turnstile候補 | 待ち列荒らしの抑止 |

独立したRails/APIサーバーは置かない。Next.jsのRoute HandlerをVercel Functionとして実行し、管理トークン検証、待ち時間計算、OneSignal REST API Keyの使用をサーバー側TypeScriptへ集約する。待ち時間計算の本体はSQLではなくTypeScriptで実装する。

同時操作でFIFOが壊れないよう、Route Handlerは施設行と対象スロットをDBトランザクション内で`SELECT ... FOR UPDATE`してからTypeScriptの計算結果を書き戻す。SQLはロック・読み書き・制約だけに用い、待ち時間計算や状態遷移の業務ロジックは持たない。

### 2.2 保存データ最小化

- 永続マスタは`charging_sites`と`site_slots`だけとする。
- 利用者データは現在有効な`queue_entries`だけに保持する。
- `charging_sessions`、`notification_events`、利用者テーブル、監査履歴テーブルはMVPでは作らない。
- 完了・取消・失効時に`queue_entries`を即時削除する。
- 再利用時はニックネームを再入力し、必要であればWeb Pushを再度有効化する。

## 3. システム構成

```text
モバイルブラウザ
  ├─ Next.js Client Components
  │    ├─ メモリ内施設検索
  │    ├─ 待ち列UI
  │    ├─ 管理トークンのローカル保持
  │    └─ Realtime内部更新イベント
  │
  ↓
Vercel
  ├─ Next.js配信 / Preview / HTTPS
  ├─ Route Handlers（サーバー側TypeScript）
  └─ 外部スケジューラー → 定期処理Route Handler
  │
  ↓
Supabase
  ├─ Postgres + RLS
  └─ Realtime Broadcast

Vercel Route Handlers
  ├─ 管理トークン・CAPTCHA検証
  ├─ DBトランザクションとTS待ち時間計算
  └─ OneSignal API ──→ Web Push
```

## 4. ログインなしの利用者識別

### 4.1 Supabase Authを使わない理由

Supabase Anonymous Sign-Inは画面にログインフォームを表示しないが、内部ではAuthユーザーIDとアクセストークンを発行する。Supabase Phone OTPも電話番号を使ったパスワードレスログインであり、Authユーザーとセッションを作る。

今回は次の要望と一致しないため、両方とも使用しない。

- 利用者ログインを実装しない。
- 利用者アカウントを作らない。
- 完了後に利用者を記憶しない。
- DB内の利用者関連データを最小化する。

### 4.2 待ち列管理トークン

待ち列参加時にRoute Handlerが256bit以上の暗号学的乱数を生成する。

1. 原文トークンをレスポンスで1回だけブラウザへ返す。
2. ブラウザは同一オリジンの`localStorage`へ、施設ID・待ち列IDとともに保存する。
3. DBには`SHA-256`等でハッシュ化した値だけを保存する。
4. 取消、充電開始、初回の時間確定、終了予定3分前の延長、完了、本人状態取得では待ち列IDと原文トークンをRoute Handlerへ送る。
5. Route Handlerがハッシュを照合してから、DBトランザクション内でTypeScriptの待ち列サービスを実行する。
6. 完了・取消・失効時にDB行を削除し、正常レスポンス後にブラウザ側トークンも削除する。

トークンはURL、Push本文、アクセスログへ含めない。厳格なCSPを設定し、XSSによる`localStorage`窃取リスクを抑える。

### 4.3 ログインなし方式の制約

- ブラウザデータを消去すると、その待ち列を操作できなくなる。
- 別端末や別ブラウザへ待ち列を引き継げない。
- 別端末からの重複参加を完全には防げない。
- 同じ利用者であることを永続的に判定できない。

これらは「利用後に利用者を記憶しない」こととのトレードオフとして許容し、CAPTCHA、IP・施設単位のレート制限、同一ブラウザの既存トークン確認で悪用を抑える。

ブラウザデータを失った待機者が残っても、先頭になって`called`へ遷移した後、充電開始ボタンが押されなければ5分で失効・削除される。そのため専用の長期セッション回収機能はMVPでは追加しない。影響は最大で呼び出し猶予の5分である。

## 5. 画面内通知とOneSignal Web Push

### 5.1 通知方針

- 画面内通知を全利用者へ提供し、Web Pushは任意とする。
- 電話番号、メールアドレス、OTP、利用者アカウントを使用しない。
- 待ち列参加後に「通知を受け取る」を表示し、利用者操作を起点に通知許可を要求する。
- 初回アクセス直後や施設検索中にはブラウザ権限を要求しない。
- Pushを拒否・未対応の場合も待ち列機能を制限しない。

### 5.2 OneSignal登録フロー

1. 利用者がニックネームで待ち列へ参加する。
2. 「通知を受け取る」を押す。
3. ブラウザが通知許可を求める。
4. 許可後、OneSignalがブラウザ・端末単位の匿名Subscriptionを作成する。
5. Subscription IDを管理トークン付きで`/api/queue/push-subscription`へ送る。
6. Route Handlerが現在の有効エントリーだけへSubscription IDを紐付ける。
7. 順番の5分前、順番到来、予定充電終了の3分前にOneSignal APIからPushを送る。
8. 完了・取消・失効時に、アプリDBからSubscription IDとの紐付けを行削除する。

OneSignalのExternal IDやログイン連携は使用しない。Push Subscriptionはブラウザ・端末に紐づく匿名識別子として扱う。

利用者向け通知は次の3種類に限定する。

| 種類 | 送信タイミング | 補足 |
|---|---|---|
| 5分前通知 | 推定呼び出し時刻の約5分前 | 同一待ち列につき1回 |
| 順番到来通知 | 対象者が`called`になった時 | 通常の空き発生と、前の利用者の5分失効による繰り上げを同じ種類として扱う |
| 充電終了確認 | 予定充電終了時刻の3分前 | 「あと3分で予定充電時刻です。まだ充電しますか？終了しましたか？」の回答を促す |

待ち列参加、取消、順位変更、初回の充電時間確定・延長確定のたびにWeb Pushを送ることはしない。これらの変更ではRealtime内部更新イベントだけを送り、開いている画面の前方人数・待ち時間・状態を静かに更新する。予定終了時刻の5分後まで回答がなく、かつ後ろに待機者がいる場合の強い催促表示は、充電終了確認と同じ通知種類の表示差分として扱う。

### 5.3 端末別条件

- Android、Windows、macOSなどの対応ブラウザでは、通常の通知許可後に利用できる。
- iPhone/iPadはiOS/iPadOS 16.4以降を対象とする。
- iPhone/iPadではWebアプリをホーム画面へ追加し、ホーム画面から起動して通知を許可する必要がある。
- `manifest.webmanifest`へ`name`、`short_name`、`start_url`、`display: standalone`、192px/512pxアイコンを設定する。
- OneSignal Service Workerをサイトの同一origin配下へ配置する。
- iPhone/iPad対象者へ、共有ボタンからホーム画面へ追加する手順を専用画面で案内する。
- Private/Incognito mode、通知拒否、ブラウザデータ削除では利用できない場合がある。
- Push到達はOS設定・集中モード・通信状態に依存するため保証せず、待機画面を正とする。

### 5.4 Pushデータと秘密情報

- `push_subscription_id`を有効な`queue_entries`行にだけ保存する。
- OneSignal App IDはブラウザ公開可能な設定値として使用する。
- OneSignal REST API KeyはVercelのserver-only環境変数へ保存し、ブラウザや`NEXT_PUBLIC_*`へ公開しない。
- 通知本文には施設名と行動案内だけを含め、ニックネーム、管理トークン、他利用者情報を含めない。
- 順番5分前・順番到来・充電終了3分前確認の送信時刻を同じ有効エントリー行に保存し、二重送信を防ぐ。
- 完了・取消・失効時にアプリDB上のSubscription IDとの紐付けを削除する。
- OneSignal側の匿名Subscription保持・削除方針はプライバシーポリシーへ明記する。

### 5.5 CAPTCHA

CAPTCHAはログインではなく、人間の操作か自動Botかを判定して大量の待ち列登録を抑える仕組みである。

MVP候補はCloudflare Turnstileとする。

1. 待ち列参加時にブラウザでTurnstile tokenを取得する。
2. tokenをリクエストと一緒に`/api/queue/join`へ送る。
3. Route HandlerがCloudflare Siteverifyへ問い合わせる。
4. 成功時だけ待ち列参加を実行する。

適用対象は`join-queue`とし、待ち時間確認、Push許可、充電開始、完了など日常操作では原則表示しない。Turnstileが利用できない場合の再試行文言をエラーカタログへ定義する。

## 6. Next.js要件

### 6.1 App Router

- App RouterとTypeScriptを使用する。
- 施設検索、待機、呼び出し、充電中画面をClient Componentとする。
- 利用者固有の状態を静的キャッシュしない。
- `window.location.reload()`を使用せず、React stateだけを差し替える。
- トークン原文をServer ComponentのログやHTMLへ埋め込まない。

### 6.2 FR-023の部分更新

Next.jsだけでは他利用者によるDB変更を検知できないため、次の方式とする。

ここでいうRealtimeイベントは、画面を最新状態にするための内部信号であり、利用者に見せる通知やOSのWeb Pushではない。

1. クライアントは施設単位のRealtime channelを購読する。
2. イベントには`site_id`と`queue_version`だけを含め、ニックネームや待ち列IDを配信しない。
3. 新しいversionを受けたら、待ち列IDと管理トークンを`/api/queue/me`へ送り、本人用スナップショットを再取得する。
4. 順位、前方人数、推定時間、状態だけをReact stateで更新する。
5. Realtime切断時は10〜15秒間隔の取得へ切り替える。

この「自動更新」はページ再読み込みではなく、サーバー側変更を受け取って必要部分だけ描画し直すことを意味する。

### 6.3 デザイン方針

- 現在のMockの配色、カード、余白、モバイル端末向けレイアウト、状態別画面の視覚表現をデザイン基準として使用する。
- 「現在地」「距離」「近い順」は削除し、自由入力検索へ置き換える。
- Web Push許可、iPhoneホーム画面追加案内、自由入力5〜120分、待ちなし、予定終了確認、エラー画面を同じデザインシステムで追加する。
- 画面一覧、画面遷移、各画面とAPIの対応は`docs/screen-flow-spec.md`を正とする。
- プロジェクト直下の`DESIGN.md`を、UI実装・画面変更・Visual QAにおける唯一のデザイン基準とする。
- Mock内の固定値・デモ進行ボタンは本番実装で削除する。

## 7. 高速施設検索

- 現在地、距離計算、地図SDKを使用しない。
- 施設名、都道府県、市区町村、住所を1つの入力欄で検索する。
- MVPでは数百件程度の検索用JSONをVercelから配信し、各キー入力時はネットワーク通信せずブラウザメモリ内で絞り込む。
- Unicode NFKC、大小文字、全角・半角、前後・連続空白を正規化する。
- 前方一致を優先し、部分一致を次点とする。
- `useDeferredValue`または`startTransition`を使い、入力欄の描画を優先する。
- 最大20候補とし、入力から候補更新まで100ミリ秒以内を目標にする。
- 施設数が数千件を超えた段階で`pg_trgm`、GIN index、`GET /api/sites`によるサーバー側検索を検討する。

## 8. API・DBアクセス制御

### 8.1 ブラウザから許可する操作

| 対象 | `anon`ロール |
|---|---|
| `charging_sites` | 直接SELECT/INSERT/UPDATE/DELETEをすべて禁止 |
| `site_slots` | 直接SELECT/INSERT/UPDATE/DELETEをすべて禁止 |
| `queue_entries` | 直接SELECT/INSERT/UPDATE/DELETEをすべて禁止 |
| Supabase Realtime | DB Changeを購読させず、Broadcastだけを受信 |

施設検索用JSON、公開施設集計、本人用状態とすべての状態変更はNext.js Route Handlerまたはビルド時生成ファイル経由に限定する。Route Handlerは管理トークン、状態、期限を検証した後だけ、サーバー専用のDB接続でトランザクションを開始する。

### 8.2 禁止事項

- Supabase Secret Key、legacy `service_role` key、OneSignal REST API Keyをブラウザへ公開しない。
- ブラウザから任意の`status`、`joined_at`、順位を直接更新させない。
- ニックネーム、Push Subscription ID、管理トークンハッシュを公開ViewやRealtimeへ含めない。
- 管理トークンだけで他施設や他エントリーを操作できないよう、待ち列ID・施設IDも照合する。

### 8.3 APIとRoute Handlerの位置づけ

本書でいうAPIは外部企業向けの公開APIではなく、ブラウザ画面と安全なサーバー処理の間のHTTP窓口を指す。

```text
「待ち列に参加」ボタン
  → POST /api/queue/join
  → CAPTCHA・入力値を確認
  → DBをロックし、TypeScriptでFIFO追加・待ち時間再計算
  → 結果JSONを画面へ返す
```

Route HandlerはNext.js内のサーバー側TypeScriptであり、Vercelでは必要なときだけFunctionとして実行される。常時稼働サーバーの管理は不要だが、OneSignal REST API Key、DB接続文字列、管理トークン照合をブラウザから隠して実行できる。

主なAPI利用箇所は待ち列参加、本人状態取得、退出、充電開始、時間確定・延長、完了、Push Subscription登録、Push送信である。施設自由検索は原則ブラウザ内で行うため、キー入力ごとにAPIを呼ばない。

各エンドポイントのJSON契約、認可方法、HTTPエラーは`docs/api-contract.md`を正とする。

## 9. 最小データモデル

カラム、型、NULL可否、Default、CHECK制約、インデックス、RLSの一次資料は[database-schema.md](/Users/haruki.shimo/Documents/tesla_supercharger/docs/database-schema.md)とする。実装エージェントは、そこから[migration](/Users/haruki.shimo/Documents/tesla_supercharger/supabase/migrations/20260722000000_initial_queue_schema.sql)を適用する。

| テーブル | 役割 | 保持期間 |
|---|---|---|
| `charging_sites` | 施設マスタ、検索用正規化文字列、ストール数、施設単位の`queue_version` | 永続 |
| `site_slots` | 実ストールまたは仮想スロット、現在の割当・空き見込み | 永続 |
| `queue_entries` | 待機・呼出・充電中だけのエントリー、管理トークンハッシュ、Push紐付け | 有効期間中のみ |

重要なカラム上の取り決めは次のとおり。

- FIFOは`joined_at, queue_order`で決める。`queue_order`はDBのidentityで同時刻の順序を固定する。
- 初回の入力時間は`initial_charge_minutes`（5〜120）と`duration_confirmed_at`の組で一度だけ確定する。`planned_duration_minutes`は使用しない。
- `called`は`assigned_slot_id`、`called_at`、`call_expires_at`を必須とし、`charging`は開始時刻・終了予定・確認期限を加えて必須とする。
- `completed`、`cancelled`、`expired`は状態値として保存せず、後続の再計算後に`queue_entries`行を削除する。

## 10. Next.js Route Handlers / Queue Service

| Route Handler | 用途 |
|---|---|
| `POST /api/queue/join` | CAPTCHA検証、管理トークン発行、FIFO末尾へ追加 |
| `GET /api/queue/me` | 管理トークン確認後に本人用状態を返す |
| `POST /api/queue/cancel` | 本人確認、後続再計算、行削除 |
| `POST /api/queue/start` | 5分以内の呼び出しを充電中へ変更し、確定前のfallback 45分を設定 |
| `POST /api/queue/duration` | 初回だけ5〜120分を検証し、終了予定と後続を再計算。確定済みなら拒否 |
| `POST /api/queue/extend` | 予定終了3分前の確認画面でだけ追加時間を検証し、終了予定と後続を再計算 |
| `POST /api/queue/complete` | スロット解放、次の呼び出し、行削除 |
| `POST /api/queue/push-subscription` | 管理トークン確認後、匿名Subscription IDを有効エントリーへ紐付け |
| `GET /api/cron/process-queue` | 順番5分前Push、終了3分前確認、呼び出し失効、自動完了を処理。外部スケジューラーだけが呼ぶ |

`lib/queue/`配下のTypeScriptを待ち列ロジックの唯一の実装元とする。待ち時間計算は最小ヒープなどの純粋関数としてテスト可能にし、Route HandlerとCron Handlerから共通利用する。排他制御は、Route HandlerがDBトランザクション内で施設状態行と対象スロットをロックして施設単位で直列化する。

完了処理例：

1. 管理トークンを検証する。
2. 施設、エントリー、割当スロットをロックする。
3. スロットを空きにする。
4. 空き数に応じてFIFO先頭を呼び出す。
5. 全待機者の推定開始時刻を再計算する。
6. 施設の`queue_version`を増やす。
7. 完了者の`queue_entries`行を削除する。
8. トランザクションを確定し、Realtime内部更新イベントを送る。

レスポンス消失後の再送で対象行が既にない場合は、完了済み相当として安全に扱える冪等レスポンスを返す。

## 11. 待ち時間計算

再計算の発火条件、発火しない通知処理、Cronとの役割分担は`docs/queue-recalculation-spec.md`を正とする。

### 11.1 暫定値

- `waiting/notified/called`が0件なら待ち時間は0分とし、現地充電車の終了予定入力を求めない。
- アプリ上の有効な待機者が0人で、利用者が「現地満車」を確認して参加した時点で待ち列を開始する。
- Tesla連携がないため、開始時点でアプリ外の充電車の残り時間は分からない。アプリで確定終了時刻があるスロットはその値を使い、それ以外を`now() + 45分`で暫定初期化する。
- 充電開始前の待機者は予定充電時間が未入力なので45分を使用する。
- 充電時間入力画面は30分を選択済みで表示し、利用者による確定を必須とする。
- 30分が確定されるまで、通信切断等へのfallbackとして45分を計算に使用する。
- 利用者が5〜120分の実際の予定時間を確定したら、その値で即時に全体を再計算する。
- 表示は「暫定：約○分」とし、5分単位へ切り上げる。

現地に空きがある、実際の並び順が異なるなどアプリ表示と現実が矛盾した場合は、現地状況・施設ルール・安全を優先する旨を全待機画面に表示する。

### 11.2 アルゴリズム

各仮想スロットの「次に空く時刻」を最小ヒープとして扱い、FIFO順に最も早いスロットへ仮割り当てする。

```ts
const slots = minHeap(siteSlots.map((slot) => slot.estimatedAvailableAt))

for (const entry of waitingEntriesByJoinedAt) {
  const startAt = slots.popMin()
  entry.estimatedStartAt = startAt

  // まだ充電開始前の利用者は時間未入力のため、施設のfallback 45分を使う。
  const assumedMinutes = site.defaultChargeMinutes
  slots.push(addMinutes(startAt, assumedMinutes))
}
```

実装は`lib/queue/recalculate.ts`などのTypeScriptで同等の計算を行う。

### 11.3 3ストールの例

現在15:20、スロットの次回空きが15:30、15:45、15:45の場合：

| 待機者 | 暫定開始 | 待ち時間 | 次回空き |
|---|---:|---:|---:|
| A | 15:30 | 10分 | 16:15 |
| B | 15:45 | 25分 | 16:30 |
| C | 15:45 | 25分 | 16:30 |
| D | 16:15 | 55分 | 17:00 |

DはAが45分充電すると仮定するため暫定55分となる。

- Aが開始後に20分と入力：Aの終了15:50、Dは15:50開始のあと30分へ更新。
- Aが開始後に60分と入力：Aの終了16:30。他2枠も16:30のため、Dは16:30開始のあと70分へ更新。

### 11.4 4ストール

4ストール施設では4つ目の次回空き時刻がDを決める。

| 4つ目の状態 | A | B | C | D |
|---|---:|---:|---:|---:|
| 現在空き | 0分 | 10分 | 25分 | 25分 |
| 15:45に空く | 10分 | 25分 | 25分 | 25分 |
| 15:50に空く | 10分 | 25分 | 25分 | 30分 |
| 不明 | 10分 | 25分 | 25分 | 計算中 |

同時に4枠空いた場合は施設単位トランザクションでFIFO先頭4件を同じ`called_at`にし、それぞれ独立した5分期限を設定する。1件だけ失効した場合は、その1枠へ次の利用者を呼ぶ。

### 11.5 予定終了と自動完了

予定時刻で直ちに次の利用者を呼んだ後に延長を許すと、空いていないストールへ案内する可能性がある。このため、予定終了の3分前に確認を始め、予定終了時刻の5分後を最終期限とする方式を採用する。

1. `expected_finish_at`の3分前に、充電画面へ「あと3分で予定充電時刻です。まだ充電しますか？それとも終了しましたか？」を表示し、Web Push有効時は端末へも送る。
2. 「まだ充電する」では追加時間を必須入力し、確定後に後続を再計算する。
3. 「終了しました」では直ちに完了処理し、次の利用者を呼び出す。
4. 無応答のまま予定終了時刻の5分後になったら自動完了し、次の利用者を呼び出す。
5. 予定終了時刻の5分後に待機者がいる場合だけ、充電利用者へ「後ろに待っている人がいるので、充電が終わっている場合は移動しましょう」と強調表示する。
6. 待機者がいない場合は強い移動文言を使わず、通常の終了確認だけを表示する。

入力値が確定済みならその分数、未確定なら充電開始から45分を`expected_finish_at`とする。

## 12. 定期処理とリアルタイム

無料の外部スケジューラーから1分ごとに`GET /api/cron/process-queue`を実行する。Vercel HobbyのCron制限を回避し、`CRON_SECRET`のBearer認証で呼び出し元を制限する。

- 推定呼び出し時刻の5分前を検出する。
- 各Push送信時刻を条件付き更新し、同一種類の送信権を1処理だけに与える。
- 5分経過した呼び出しを失効させ、行削除後に次を呼ぶ。
- 予定終了時刻の3分前に延長・終了確認を開始する。
- 予定終了時刻の5分後までに追加時間・完了入力がなければ、自動完了、行削除、次の呼び出しを同一トランザクションで処理する。
- 完了・取消時はCronを待たずに即時処理する。

Realtime内部更新イベントは個人データを含まない施設version通知に限定する。クライアントはイベント受信後に管理トークン付きで本人状態を取り直す。このイベント自体は画面表示、音、振動、Web Pushを発生させない。

channel、再取得、切断時の挙動は`docs/realtime-spec.md`を正とする。

### 12.1 Realtime channel仕様案

channelはチャットルームではなく、同じ施設の内部更新イベントを受け取るための論理的な購読先である。ここで受け取るのは「施設の状態が変わった」という再取得の合図であり、利用者向け通知ではない。

| 項目 | 値 |
|---|---|
| Topic | `site:<charging_site_id>` |
| Event | `queue_changed` |
| Payload | `{ "siteId": "uuid", "queueVersion": 123 }` |
| 公開範囲 | private。個人情報を含めない |
| 再取得 | event受信後、`get-my-queue`で本人状態を取得 |
| 切断時 | 10〜15秒pollingへ切替 |
| 再接続時 | 現在の`queue_version`を取得し、差分があれば再取得 |

`charging_sites.queue_version`のDB Triggerだけがprivate Broadcastを送る。`anon`ロールには受信（SELECT）だけを許可し、ブラウザ送信に必要なINSERT policyは作らない。これにより、利用者ログインやアカウントを作らずに、ブラウザからの偽イベント送信を防ぐ。順位、ニックネーム、Push Subscription ID、待ち列ID、管理トークンはBroadcast payloadへ含めない。

## 13. データ削除

### 13.1 論理上の即時削除

次の時点で有効エントリー行を削除する。

- 「充電が終わりました」が成功した時
- 利用者が待ち列から退出した時
- 呼び出し後5分以内に開始しなかった時

削除トランザクション内で、スロット解放、後続繰り上げ、待ち時間再計算、`queue_version`更新を先に完了する。別の利用履歴・通知履歴・利用者テーブルへコピーしない。

削除後に`waiting/notified/called`がすべて0件になった場合は`queue_started_at`をnullへ戻し、施設表示を待ち人数0人・待ち時間0分とする。`charging`エントリーの確定終了時刻は本人の終了処理まで保持するが、アプリ外車両用の暫定終了時刻は待ち時間表示に使用しない。

### 13.2 削除できない範囲

- DBバックアップにはバックアップ保持期間中、削除前データが含まれる可能性がある。
- OneSignalは通知配信・不正防止のため匿名Subscriptionや配信情報を一定期間保持する場合がある。
- Vercel、Supabase、OneSignalのインフラログは各サービスの保持設定に従う。

「アプリから即時削除」は保証するが、外部事業者・バックアップを含む物理的な即時消去は保証しない。公開するプライバシーポリシーにもこの差を記載する。

## 14. スキーマ・施設データの更新

運用管理画面と運用者Authは実装しない。管理者PCを唯一の変更元とし、Supabase migrationをGit管理する。

```text
supabase/migrations/<timestamp>_<change_name>.sql
supabase/seed.sql
```

標準手順：

1. 管理者PCでmigrationを作成する。
2. ローカルSupabaseへ適用し、`supabase db reset`とSQLテストで確認する。
3. migrationをGitへ保存する。
4. `supabase db push`で本番へ適用する。
5. アプリ変更がある場合はVercelへデプロイする。

施設名、ストール数、標準45分からの施設別上書き、受付停止などのマスタ変更も、SQL migrationまたはseedのupsertとして管理する。本番Dashboardから直接変更してmigration履歴とずらさない。

ここで必要な`supabase login`は管理者PC上のCLIデプロイ認証であり、アプリ利用者向けログイン機能ではない。

### 14.1 初期施設データ作成

実装エージェントへ次の作業を明示的に依頼する。

1. Tesla公式の施設検索を第一候補として、日本国内のスーパーチャージャーを調査する。
2. 施設名、都道府県、市区町村、住所、ストール数、最大出力、参照URL、確認日を一覧化する。
3. 住所と施設名を正規化し、表記違いによる重複候補を抽出する。
4. 管理者確認用CSV/JSONを生成する。
5. 確認済みデータだけを`seed.sql`またはmigrationのupsertへ変換する。

Web検索結果を確認なしで本番DBへ直接書き込ませない。施設閉鎖・移転・ストール増減があり得るため、出典URLと確認日をマスタに保持する。

## 15. Vercel・HTTPS

- `main`をProduction、Pull RequestをPreview Deploymentとする。
- PreviewとProductionの環境変数を分離する。
- 本番OneSignal REST API KeyをPreviewへ渡さない。
- VercelによるSSL証明書の自動発行・更新を使用し、独自証明書処理を実装しない。
- HTTPSは実装項目ではなく、管理トークンとPush Subscription IDを扱う通信要件として維持する。

### 15.1 環境変数

環境変数の名前、公開可否、設定先は`docs/deployment-configuration.md`で管理する。ブラウザへ公開するのは`NEXT_PUBLIC_*`の値だけとし、DB接続文字列、OneSignal REST API Key、Cron用秘密値、冪等性トークン導出秘密値はVercelのserver-only環境変数へ設定する。Supabaseの`service_role`キーはこの構成では使用しない。

## 16. セキュリティ・プライバシー

- CAPTCHAを待ち列参加に適用する。
- IP、施設、待ち列ID単位でレート制限する。
- 状態遷移を行ロックと状態条件で冪等にする。
- ニックネームをエスケープし、制御文字を除去する。
- 厳格なCSP、Referrer-Policy、X-Content-Type-Optionsを設定する。
- DB接続文字列、OneSignal REST API Key、外部Cron用の秘密値など、Vercel server-only環境変数をGitへ含めない。
- 個人データ、秘密値をエラー監視サービスへ送らない。
- 管理画面、運用者ロール、運用者JWTをMVPでは作らない。

## 17. 性能目標

| 項目 | 目標 |
|---|---|
| 施設検索 | 入力から候補更新まで100ミリ秒以内 |
| 初期表示 | 4G回線で3秒以内を目標 |
| Route Handler | 95パーセンタイル1秒以内（OneSignal応答待ちを除く） |
| 変更反映 | 通常5秒以内、切断時は10〜15秒polling |
| 初期規模 | 1施設100待機者、全体1,000同時接続を上限目標 |

## 18. テスト要件

- 施設名検索の正規化、前方一致、100ms性能テスト
- 管理トークン不一致、他エントリーID、期限切れ操作の拒否テスト
- ブラウザから`queue_entries`を直接参照・更新できないこと
- 同時参加でFIFO順が壊れないこと
- 4スロット同時解放で先頭4件だけが呼ばれること
- 完了・失効・Cronが競合しても二重呼び出ししないこと
- 標準45分と、Aの入力後の再計算テスト
- 待機者0人で待ち時間0分となり、終了時刻入力を要求しないこと
- 待ち人数0人の施設で待ち列を新規開始した時、確定値のないスロットだけが45分で初期化されること
- 充電時間UIは30分が初期選択され、未確定中だけ45分fallbackを使うこと
- 充電時間4、5、120、121分の境界値テスト
- 予定終了3分前の確認、追加時間、予定終了時刻の5分後の無応答自動完了、待機者有無による文言分岐
- 完了・取消・失効後にエントリーとPush Subscription IDの紐付けが残らないこと
- 通知拒否、未対応ブラウザ、iPhoneホーム画面未追加、無効Subscriptionのテスト
- 5分前条件を複数回またいでもWeb Pushが1回だけ送られること
- 順番5分前・順番到来・充電終了3分前確認Pushの本文とクリック遷移テスト
- Realtime切断時のpollingフォールバックテスト

## 19. MVP開始前に確定すべき事項

1. OneSignal App、通知アイコン、通知許可前の説明文、外部事業者側のデータ保持期間
2. CAPTCHAとしてCloudflare Turnstileを正式採用するか
3. `docs/error-catalog.md`の文言、Push失敗時の再試行回数
4. エージェントが作成した国内施設一覧の管理者レビュー
5. 施設別に標準45分を上書きできるようにするか
6. APIのJSON契約、DB migration、RLS、TypeScript待ち列サービスの確定
7. 環境変数名、Preview/Production構成、完成判定チェックリスト
8. Supabase projectとVercel Functionのリージョン

## 20. 公式仕様参照

- [Supabase Users](https://supabase.com/docs/guides/auth/users)
- [Supabase Phone Login](https://supabase.com/docs/guides/auth/phone-login)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Realtime](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Supabase Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [cron-job.org](https://cron-job.org/en/)
- [OneSignal Web Push Setup](https://documentation.onesignal.com/docs/en/web-push-setup)
- [OneSignal iOS Web Push Setup](https://documentation.onesignal.com/docs/en/web-push-for-ios)
- [Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- [Cloudflare Turnstile Server-side Validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Vercel SSL Certificates](https://vercel.com/docs/domains/working-with-ssl)
