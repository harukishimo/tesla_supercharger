# コーディング完了・デプロイ引き継ぎマスタープロンプト

以下を、そのままコーディングエージェントへ渡す。AIは実装とローカル検証までを担当し、**環境変数の実値設定、Supabaseへのリモート適用、Vercelデプロイは運営者が担当する。**

~~~text
# スパQ — コーディング完了・デプロイ引き継ぎ指示

あなたはスパQのリード実装エージェントです。設計資料に基づいて、実装、ローカル検証、Red / Blue / Purple Teamの最終レビュー、運営者へのデプロイ引き継ぎ資料作成までを完了してください。

## 最終ゴール

次のすべてを満たし、運営者が環境変数を設定してSupabaseとVercelへ反映すれば確認できる状態を作ること。

1. Next.js + TypeScript + Supabase + Vercel向けのWebアプリが実装されている。
2. 日本国内152施設・752ストールのmigration / seedが、空のローカル検証DBへ適用・検証されている。
3. 利用者がスマホで、施設検索から待ち列参加、待機、呼出、充電開始、初回充電時間の確定、終了または延長、完了までを実行できる。
4. Realtime、期限処理、任意のWeb Push、エラー表示、管理トークンによる本人操作が実装されている。
5. `.env.example`、Supabase反映手順、Vercel設定手順、デプロイ後の確認手順が揃っている。
6. Red Team、Blue Team、Purple Teamの総合レビューを完了し、Purple Teamが「デプロイ引き継ぎ可」と判定している。
7. Lint、型検査、単体試験、統合試験、E2E、production buildの証跡がある。

「コードを書いた」だけでは完了にしない。運営者が秘密情報を設定し、migration / seedを適用し、Vercelへデプロイするために必要な成果物・手順・検証結果が揃って初めて完了とする。

## AIの作業範囲外

次の操作は**絶対に実行しない**。運営者が行う作業として、必要な値の名称と手順だけを文書化する。

- 実際の環境変数値・秘密情報の受領、保存、設定、表示
- Supabase Cloud上のmigration / seed適用、RLS変更、データ更新
- Vercel project作成、Vercelへのリンク、Preview / Production Deployment
- OneSignal / Cloudflare Turnstileのダッシュボード設定、実際のPush送信
- 本番ドメイン、利用規約の運営者情報、プライバシーポリシーURLの登録

ローカル検証に必要なダミー値は、実サービスに接続できないことが明確な開発専用値だけを使用してよい。実際の秘密情報、URL、キー、トークンを推測・生成・コミットしてはならない。

## 必ず最初に読む正本資料

実装開始前に、以下をすべて読む。矛盾があれば実装せず、矛盾点と選択肢を運営者へ報告すること。

- docs/requirements-definition.md
- docs/technical-requirements.md
- docs/screen-flow-spec.md
- docs/database-schema.md
- docs/api-contract.md
- docs/queue-recalculation-spec.md
- docs/realtime-spec.md
- docs/error-catalog.md
- docs/deployment-configuration.md
- docs/terms-of-service.md
- docs/tesla-japan-supercharger-research.md
- docs/coding-agent-structure.md
- docs/implementation-plan.md
- DESIGN.md
- supabase/migrations/20260722000000_initial_queue_schema.sql
- supabase/seed/20260722_japan_superchargers.sql

仕様の優先順位は、運営者からこのプロンプトと一緒に渡された追加指示、次に上記の仕様書、最後に実装上の推測とする。推測で要件を広げない。

## 実装計画書の遵守とエージェント呼び出し

`docs/implementation-plan.md`は、実装順・ゴール・完了条件・禁止事項を定める**実装上の正本**である。IP-00からRV-03までを、同資料に記載された順序と出口条件どおりに実行すること。実装上の判断が必要になった場合も、まず実装計画書、次に関連する詳細仕様書へ戻ること。

利用可能なエージェント機能がある場合は、各工程で次の担当エージェントを必ず呼び出す。リード実装エージェントはA0として、成果物の統合と工程の出口判定だけを行う。担当外の実装を自己判断で横取りしない。

| 工程 | 呼び出す担当 | 依頼する責務 |
|---|---|---|
| IP-00 | A0 実装統括・統合 | 正本資料の確認、作業範囲・所有ファイル・出口条件の固定 |
| IP-01 / IP-02 | A1 基盤・データ担当 | Next.js基盤、ローカル検証DB、migration / seed、RLS、設定・デプロイ引き継ぎ資料 |
| IP-03 / IP-04 | A2 待ち列ドメイン・API担当 | TypeScript計算、状態遷移、Route Handler、Cron、Realtime、Push / CAPTCHA結線 |
| IP-05 | A3 フロントエンド・PWA担当 | Mock準拠UI、全画面、レスポンシブ、PWA、画面内状態更新 |
| IP-06 | A2とA3 | API・画面・ローカル検証DBの統合、E2E、Realtime / polling / 通知拒否の検証 |
| RV-01 | R1 Red Team | 攻撃・不正操作・競合・期限境界・情報漏えいの独立レビュー |
| RV-02 | R2 Blue Team | 防御・復旧・設定分離・エラー・レスポンシブ・運用引き継ぎの独立レビュー |
| RV-03 | R3 Purple Team | Red指摘とBlue対策の突合、回帰試験、デプロイ引き継ぎ可否の最終判定 |

各担当エージェントへは、必ず次を含む具体的なタスクを渡す。

- タスクIDと対象工程
- 参照すべき仕様書
- ゴール、完了条件、してはいけないこと
- 所有してよいファイルと、他担当の所有ファイル
- 実行すべきテストと、引き継ぎ時に提出する証跡

工程は並行で先走らせない。A0は、前工程の完了条件がPASSであることを確認してから次の担当エージェントを呼び出す。R1、R2、R3はIP-07の実装凍結後にだけ呼び出し、各レビュー担当は自分が実装した成果物を自ら承認してはならない。

利用環境に複数エージェント機能がない場合は、上記の担当を独立した作業パスとして順番に実行し、担当別の報告を分けて残す。それでも、Red / Blue / Purpleの最終レビューは、実装時とは別の観点・別のコンテキストで行うこと。

## 非交渉の要件

### 技術構成

- Next.js App Router + TypeScriptを使う。
- Vercelで動くRoute HandlerとVercel Cronをサーバー処理として実装する。独立した常時稼働バックエンドは作らない。
- Supabase Postgresを施設・仮想ストール・有効な待ち列の保存先として実装する。
- 待ち時間計算と状態遷移の業務ロジックは、サーバー側TypeScriptの純粋関数として実装する。SQLに業務ロジックを埋め込まない。
- Supabase Realtime Broadcastは、施設単位の「状態が変わった」という通知にだけ使う。payloadへ個人情報を入れない。
- OneSignal Web Pushは任意通知として実装する。画面内の状態確認はPushの有無に依存させない。
- 公開運用用のCloudflare Turnstile結線を実装する。実キー設定は運営者の担当である。

### 利用者・待ち列の不変条件

- ログイン、Supabase Auth、匿名Auth、電話番号、SMS、メール、OTP、Teslaアカウントを実装しない。
- 利用者はニックネームだけで待ち列へ参加する。利用規約・プライバシーポリシーへの同意を必須にする。
- 待ち列参加時に256bit以上の管理トークンを発行する。DBにはSHA-256等のハッシュだけを保存し、原文は同一originのlocalStorageへ保持する。
- 完了、退出、呼出失効、自動完了時には、後続の再計算を同一トランザクションで完了してから`queue_entries`を削除する。履歴・利用者テーブルを追加しない。
- FIFOは`joined_at, queue_order`で決める。各施設をロックし、同時参加・同時完了・再送・Cron重複で順番やスロット割当が壊れないようにする。
- 待ち列開始時、終了時刻が不明なストールは45分を暫定値として扱う。
- 初回充電時間は30分を選択済みで表示し、5〜120分の範囲で一度だけ確定する。確定後の任意変更は不可とする。
- 延長は終了予定時刻の3分前からだけ許可する。終了予定の5分後までに延長・完了がなければ、自動完了して次を繰り上げる。
- Pushは、順番約5分前、順番到来、終了予定3分前確認の3種類だけにする。
- アプリ表示と現地の状況が異なる場合は、現地の空き・施設ルール・安全を最優先する。

### UI・レスポンシブの不変条件

- 現在のMockとDESIGN.mdを唯一のデザイン基準にする。Mock専用のデモ操作や固定値は残さない。
- モバイルファーストで実装し、レスポンシブ対応を必須とする。
- `320px`、`360px`、`390px`、`430px`幅、縦向き・横向き、ソフトウェアキーボード表示時に、横スクロール、文字切れ、タップ不能な主CTA、safe areaとの重なりを発生させない。
- 700px未満は全画面アプリ面、700px以上は最大幅480pxのアプリ面を中央に置く。
- 施設検索はクライアント内で行い、入力ごとにサーバーAPIを呼ばない。日本語正規化・前方一致を優先し、最大20件、入力から候補表示まで100msを目標にする。
- 現在地、距離、近い順、地図、Google Maps、Teslaのブランドを示唆する表示、任意の充電時間変更UIを追加しない。

### セキュリティ・秘密情報の不変条件

- `SUPABASE_DATABASE_URL`、`ONESIGNAL_REST_API_KEY`、`CRON_SECRET`、`TURNSTILE_SECRET_KEY`、管理トークン原文を、クライアント、URL、Push本文、ログ、エラー、コミットへ出さない。
- `SUPABASE_SERVICE_ROLE_KEY`は使用・設定しない。
- `NEXT_PUBLIC_*`へ入れるのは公開可能な値だけとする。
- RLS、Route Handlerの入力検証、CAPTCHA、Rate Limit、CSP、管理トークン照合を弱めて実装を簡略化しない。

## 実行手順 — ウォーターフォール

各工程の出口条件を満たして記録してから次の工程へ進む。実装担当の自己チェックは行うが、実装全体の独立レビューは最後まで開始しない。

1. IP-00 計画凍結
   - 実装対象、正本資料、担当範囲、未確定の外部設定を確認する。
   - 既存の作業ツリーを確認し、関係ない変更を消したり上書きしたりしない。

2. IP-01 基盤
   - Next.js、TypeScript、Lint、型検査、テスト、production build、`.env.example`、`vercel.json`、READMEを作る。
   - server-onlyのDB接続と、公開環境変数を分離する。

3. IP-02 DBと初期データ
   - Supabase migrationとseedをローカル検証DBへ適用できる状態にする。
   - 空の検証DBへmigrationとseedを適用し、152施設、合計752ストール、752仮想スロットを確認する。
   - リモートSupabaseへの接続・適用はしない。運営者が実行する手順と期待値をREADMEへ書く。

4. IP-03 待ち列ドメイン
   - `lib/queue/`などに、計算・状態遷移・期限判定の純粋TypeScript関数と単体試験を実装する。
   - 3 / 4ストール、45分fallback、確定時間、延長、同時空き、待ちなし、期限境界をテストする。

5. IP-04 API、Cron、通知、Realtime
   - API契約にあるRoute Handler、管理トークン、DBトランザクション、冪等処理、Cron、Broadcast、OneSignal / Turnstileの結線を実装する。
   - 実キーが未設定でも、秘密情報を仮造せず、安全な開発用の無効化状態または明示的な設定不足エラーにする。

6. IP-05 画面・PWA
   - S-01〜S-18をMock準拠で実装する。
   - 検索、参加、待機、カウントダウン、通知許可、充電開始、初回時間、終了・延長、完了、エラー・復旧不可を実装する。
   - 指定モバイル幅、向き、キーボード表示を実機またはブラウザエミュレーションで確認する。

7. IP-06 統合
   - 画面と実際のRoute Handler、ローカル検証DBを結線する。API mockだけで完了にしない。
   - Realtime切断時のpollingと再接続時の再同期、通知拒否時の継続、複数利用者の同時操作、Cron期限処理をE2Eで確認する。

8. IP-07 実装凍結
   - Lint、型検査、単体試験、統合試験、E2E、production buildを通す。
   - レビュー対象commit、migration、seed、環境変数名、テスト結果、既知の制約を固定する。

9. RV-01 Red Team
   - 不正なトークン・改ざんリクエスト・多重送信・同時操作・期限境界・個人情報露出・通知拒否・切断を用いて破綻を探す。
   - Critical / Highは再現手順・証跡・影響・修正要求を必ず残す。

10. RV-02 Blue Team
    - RLS、Route Handler、トークンハッシュ、CAPTCHA、Rate Limit、CSP、Cron冪等性、復旧、環境変数の分離、エラー文言、レスポンシブ、アクセシビリティ、利用規約導線を確認する。
    - Critical / Highが0件になり、Mediumは運営者の明示受容が必要なものとして残す。

11. RV-03 Purple Team
    - Redの再現手順とBlueの対策を突合し、元の問題が直り、通常動線に回帰がないことを再試験する。
    - すべての必須受入条件がPASSの場合だけ「デプロイ引き継ぎ可」を判定する。

レビューで不具合を見つけた場合は、最小の修正だけを実装し、影響するテストとRed / Blue / Purpleの必要な再確認を行う。修正に新機能、仕様外の改善、データモデルの拡張を混ぜない。

## 環境変数・デプロイの引き継ぎ資料

AIは、次を実値なしで作成・更新する。

1. `.env.example`
   - 次の変数名、公開 / 非公開、用途、必須条件をコメントで示す。
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_DATABASE_URL`
   - `NEXT_PUBLIC_APP_URL`
   - `CRON_SECRET`
   - `NEXT_PUBLIC_ONESIGNAL_APP_ID`
   - `ONESIGNAL_REST_API_KEY`
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `QUEUE_IDEMPOTENCY_SECRET`

2. READMEの「運営者が行う設定・反映手順」
   - Supabase projectでmigrationとseedを適用する順序、期待値（152施設・752ストール・752仮想スロット）、確認SQL。
   - VercelでDevelopment / Preview / Productionごとに設定する環境変数名。秘密値を`NEXT_PUBLIC_*`へ入れない注意。
   - `vercel.json`のCron設定と、Vercelプラン上の1分Cron要件。
   - OneSignalのPreview / Production分離、Service Worker、通知許可の確認手順。
   - Cloudflare Turnstileの公開版設定と、Preview限定では未設定を許容する条件。
   - Vercelデプロイ後のスモークテスト手順と、失敗時の確認箇所。

3. デプロイ引き継ぎチェックリスト
   - 実値を記載せず、運営者がチェックできる項目だけを列挙する。
   - Supabase、Vercel、OneSignal、Turnstile、利用規約・プライバシーポリシー、Cron、デプロイURL、スモークテストを含める。

環境変数の実値、Vercel project名、Supabase project ref、OneSignal / Turnstileの実キーを求めたり表示したりしない。必要な変数名と設定場所を文書化するだけにする。

## 最終報告の形式

最終回答は、次だけを簡潔に報告する。

1. 実装済み機能と、変更した主なファイル
2. 実行結果（Lint、型検査、単体、統合、E2E、build、ローカルDBのmigration / seed検証）
3. Red / Blue / Purple Teamの判定と、残存リスク
4. 運営者が設定する環境変数名と、設定先の一覧。値は絶対に表示しない。
5. 運営者が実行するSupabase反映・Vercelデプロイ・デプロイ後スモークテストへのリンク
6. 未実装ではなく、運営者の外部サービス設定待ちとなる項目

Vercel URLやSupabase Cloudの適用結果を、AIが実行していないのに報告してはならない。外部設定とデプロイは運営者の担当であり、AIの完了条件は「安全かつ再現可能な引き継ぎ」にある。
~~~

## 運営者が後で行うこと

AIから引き継いだ後、運営者は以下を実行する。

1. Supabaseの対象プロジェクトへmigrationとseedを適用し、152施設・752ストール・752仮想スロットを確認する。
2. VercelのDevelopment / Preview / Productionへ必要な環境変数を設定する。
3. OneSignalとTurnstileを設定する。一般公開前はTurnstileを有効にする。
4. VercelへPreviewまたはProductionをデプロイする。
5. READMEのデプロイ後スモークテストを実行し、デプロイURLを確認する。

AIが実値を扱わないため、秘密情報をコーディングエージェントの会話やプロンプトへ貼り付ける必要はない。
