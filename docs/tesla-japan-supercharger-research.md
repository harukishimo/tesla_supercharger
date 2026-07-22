# 日本国内 Tesla スーパーチャージャー 初期データ調査・登録資料

## 1. 結論

2026-07-22（JST）時点で、Tesla JapanのFind Us一覧に掲載される日本国内のスーパーチャージャーは**152施設**である。ストール数の合計は**752基**として、初期seed候補を作成した。

- 登録用CSV: [tesla-japan-superchargers-2026-07-22.csv](/Users/haruki.shimo/Documents/tesla_supercharger/data/tesla-japan-superchargers-2026-07-22.csv)
- Supabase用seed SQL: [20260722_japan_superchargers.sql](/Users/haruki.shimo/Documents/tesla_supercharger/supabase/seed/20260722_japan_superchargers.sql)
- DBスキーマ: [database-schema.md](/Users/haruki.shimo/Documents/tesla_supercharger/docs/database-schema.md)

このタスクでは実DBへの書込みはしていない。seedはレビュー・承認後に管理者が適用する。

## 2. 収集範囲と結果

| 項目 | 値 |
|---|---:|
| Tesla Japan公式一覧の掲載施設数 | 152 |
| Supercharge.infoのJapanデータ | 170 |
| 上記のうちOPEN | 152 |
| 除外したVOTING / PLAN等 | 18 |
| seed対象ストール数 | 752 |
| 調査日 | 2026-07-22（JST） |

対象は、Tesla Japanの「テスラ専用 スーパーチャージャー ステーション一覧」に現在掲載される施設だけである。建設予定・投票候補・閉鎖情報はseedに含めない。

## 3. 情報源と照合方法

| 項目 | 情報源 | 用途 |
|---|---|---|
| 施設の採否、名称、住所 | [Tesla Japan Find Us一覧](https://www.tesla.com/ja_JP/findus/list/superchargers/Japan) | 152件の母集団と日本語表記を確定 |
| 個別施設の確認URL | https://www.tesla.com/ja_JP/findus/location/supercharger/{tesla_location_id} | 各CSV行のofficial_source_url。運用時の再確認先 |
| ストール数、最大出力、稼働状態 | [Supercharge.info allSites API](https://supercharge.info/service/supercharge/allSites) | status = OPENのstallCountとpowerKilowattを取得 |

照合は、原則として郵便番号の完全一致で行った。141件は一意に一致した。11件は公開データ側の郵便番号・所在地表記の差異または重複のため、Teslaの施設名・公式一覧住所・Tesla location IDを用いて個別に対応付けた。

ストール数は変動し得る情報である。正式リリース前、およびストール数を変更するseedの再実行前には、CSVのofficial_source_urlで必要な施設を再確認すること。

## 4. 登録データのカラム

| CSVカラム | 内容 | DBへの使用 |
|---|---|---|
| official_list_id | Tesla公式一覧上の並び順 | 調査・照合用のみ |
| name / address / prefecture | Tesla公式一覧の日本語表記 | charging_sitesへ登録 |
| municipality | 今回は未分解 | NULL。検索は住所全体で可能 |
| stall_count | 稼働中ストール数 | charging_sites.stall_countと仮想site_slots数 |
| max_kw | 最大出力 | 調査用。現行スキーマへは保存しない |
| tesla_location_id | Tesla Find Usの個別URL識別子 | 調査用 |
| official_source_url | Tesla個別施設ページ | charging_sites.source_urlへ登録 |
| stall_count_source_url | ストール数の取得元 | 調査用 |
| source_checked_at | 今回の確認日 | charging_sites.source_checked_atへ登録 |
| review_status | 照合方法 | postal_code_matchまたはmanual_match_reviewed。調査用 |

## 5. seedの安全性

seed SQLは、公式個別URLをcharging_sites.source_urlの一意キーとして使用する。

- 既存サイトは更新し、未登録サイトだけ追加する。
- 各サイトに必要な数だけ仮想site_slotsを追加する。
- 取得ストール数が将来減った場合、既存スロットを自動削除しない。待ち列に影響するため、削除は別のレビュー済みmigrationで行う。
- queue_enabledは既存値を上書きしない。
- 有効な待ち列がある施設のストール数を変更するseedは適用しない。

## 6. 適用手順

1. [初期スキーマmigration](/Users/haruki.shimo/Documents/tesla_supercharger/supabase/migrations/20260722000000_initial_queue_schema.sql)を先に適用する。
2. CSVで名称・住所・ストール数をレビューする。特にreview_status = manual_match_reviewedの11件を再確認する。
3. 本番前に、対象Supabaseプロジェクトへ接続した環境で次を実行する。

~~~bash
psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/seed/20260722_japan_superchargers.sql
~~~

4. 新規環境では次の確認値が期待される。

~~~sql
select count(*) as sites, sum(stall_count) as stalls
from public.charging_sites;
-- sites = 152, stalls = 752

select count(*) as slots
from public.site_slots;
-- slots = 752
~~~

既に別データを登録済みの環境では、上記の合計値は増減する。公式URLで絞り込んで確認する。

## 7. 運用ルール

- 施設の追加・閉鎖・ストール数変更は、公式Tesla一覧を起点にCSVを更新してからseedまたはmigrationをレビューする。
- 本アプリはTesla公式ではなく、ストール数・施設利用可否・現地の混雑を保証しない。
- 施設の物理的な満空はこのseedでは分からない。待ち列の初期化と現地満車確認は、既存要件どおりアプリ利用者の現地確認を基にする。
