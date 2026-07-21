"use client";

import { useMemo, useState } from "react";

type Site = {
  id: number;
  name: string;
  area: string;
  address: string;
  stalls: number;
  power: number;
  heading: number;
  charging: number;
  eta15: number;
  status: "空きあり" | "やや混雑" | "混雑" | "情報なし";
  updated: string;
  x: number;
  y: number;
  distance: string;
};

const sites: Site[] = [
  { id: 1, name: "東京・有明", area: "東京都", address: "東京都江東区有明2丁目", stalls: 12, power: 250, heading: 3, charging: 5, eta15: 2, status: "やや混雑", updated: "1分前", x: 70, y: 61, distance: "8.4 km" },
  { id: 2, name: "東京・六本木", area: "東京都", address: "東京都港区六本木6丁目", stalls: 6, power: 250, heading: 1, charging: 2, eta15: 1, status: "空きあり", updated: "2分前", x: 61, y: 53, distance: "4.2 km" },
  { id: 3, name: "横浜・みなとみらい", area: "神奈川県", address: "神奈川県横浜市西区", stalls: 8, power: 250, heading: 5, charging: 7, eta15: 3, status: "混雑", updated: "たった今", x: 54, y: 76, distance: "31 km" },
  { id: 4, name: "川崎", area: "神奈川県", address: "神奈川県川崎市幸区", stalls: 8, power: 250, heading: 2, charging: 3, eta15: 0, status: "空きあり", updated: "4分前", x: 60, y: 67, distance: "18 km" },
  { id: 5, name: "柏", area: "千葉県", address: "千葉県柏市大島田1丁目", stalls: 8, power: 250, heading: 0, charging: 1, eta15: 0, status: "空きあり", updated: "8分前", x: 79, y: 38, distance: "34 km" },
  { id: 6, name: "さいたま新都心", area: "埼玉県", address: "埼玉県さいたま市大宮区", stalls: 6, power: 150, heading: 4, charging: 4, eta15: 2, status: "やや混雑", updated: "3分前", x: 52, y: 27, distance: "29 km" },
  { id: 7, name: "木更津", area: "千葉県", address: "千葉県木更津市金田東3丁目", stalls: 8, power: 250, heading: 1, charging: 0, eta15: 1, status: "空きあり", updated: "12分前", x: 76, y: 84, distance: "47 km" },
  { id: 8, name: "高崎", area: "群馬県", address: "群馬県高崎市棟高町", stalls: 6, power: 250, heading: 0, charging: 0, eta15: 0, status: "情報なし", updated: "35分前", x: 25, y: 12, distance: "112 km" },
];

const statusClass: Record<Site["status"], string> = {
  "空きあり": "is-open",
  "やや混雑": "is-medium",
  "混雑": "is-busy",
  "情報なし": "is-unknown",
};

export default function Home() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("すべて");
  const [selectedId, setSelectedId] = useState(1);
  const [detailOpen, setDetailOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [eta, setEta] = useState("30分");
  const [vehicle, setVehicle] = useState("Model 3 · 72%");
  const [registered, setRegistered] = useState(false);
  const [mapType, setMapType] = useState<"map" | "list">("map");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return sites.filter((site) => {
      const matchesQuery = !normalized || `${site.name}${site.area}${site.address}`.toLowerCase().includes(normalized);
      const matchesFilter = filter === "すべて" || (filter === "空きあり" ? site.status === "空きあり" : site.power >= 250);
      return matchesQuery && matchesFilter;
    });
  }, [query, filter]);

  const selected = sites.find((site) => site.id === selectedId) ?? sites[0];

  function selectSite(id: number) {
    setSelectedId(id);
    setDetailOpen(true);
    setRegistered(false);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Charge Scout ホーム">
          <span className="brand-mark">C</span>
          <span className="brand-name">CHARGE SCOUT</span>
          <span className="brand-tag">BETA</span>
        </div>
        <div className="header-actions">
          <button className="icon-button help-button" aria-label="ヘルプ">?</button>
          <button className="tesla-button" onClick={() => setConnectOpen(true)}>
            <span className="tesla-t">T</span>
            Teslaと連携
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="施設名・住所から検索"
              aria-label="施設名・住所から検索"
            />
            <button className="locate-inline" aria-label="現在地を使う" onClick={() => setQuery("東京")}><span>⌖</span></button>
          </div>

          <div className="filter-row" aria-label="施設の絞り込み">
            {["すべて", "空きあり", "250kW"].map((item) => (
              <button key={item} className={filter === item ? "filter active" : "filter"} onClick={() => setFilter(item)}>{item}</button>
            ))}
          </div>

          <div className="results-heading">
            <div><strong>{filtered.length}</strong><span>件の施設</span></div>
            <button onClick={() => setMapType(mapType === "map" ? "list" : "map")}>{mapType === "map" ? "距離順" : "地図表示"} <span>↕</span></button>
          </div>

          <div className="site-list">
            {filtered.map((site) => (
              <button key={site.id} className={selected.id === site.id ? "site-card selected" : "site-card"} onClick={() => selectSite(site.id)}>
                <div className="card-topline">
                  <span className={`status-dot ${statusClass[site.status]}`} />
                  <strong>{site.name}</strong>
                  <span className="distance">{site.distance}</span>
                </div>
                <p>{site.address}</p>
                <div className="card-stats">
                  <span><b>{site.stalls}</b> ストール</span>
                  <span><b>{site.power}</b> kW</span>
                  <span className={statusClass[site.status]}>{site.status}</span>
                </div>
              </button>
            ))}
            {filtered.length === 0 && <div className="empty-state"><span>⌕</span><strong>施設が見つかりません</strong><p>別の地域名で検索してください。</p></div>}
          </div>
          <div className="data-note"><span>ⓘ</span><p>施設情報はOpenStreetMapなどの公開データをもとにしています。</p></div>
        </aside>

        <div className={mapType === "list" ? "map-area list-mode" : "map-area"}>
          <div className="map-canvas" aria-label="関東地方のスーパーチャージャーマップ">
            <div className="water-label">東京湾</div>
            <div className="land land-main" />
            <div className="land land-peninsula" />
            <div className="road road-one" />
            <div className="road road-two" />
            <div className="road road-three" />
            <span className="map-label tokyo">東京都</span>
            <span className="map-label saitama">埼玉県</span>
            <span className="map-label chiba">千葉県</span>
            <span className="map-label kanagawa">神奈川県</span>
            {filtered.map((site) => (
              <button
                key={site.id}
                className={selected.id === site.id ? `marker selected ${statusClass[site.status]}` : `marker ${statusClass[site.status]}`}
                style={{ left: `${site.x}%`, top: `${site.y}%` }}
                onClick={() => selectSite(site.id)}
                aria-label={`${site.name}、${site.status}`}
              >
                <span className="bolt">ϟ</span>
                {site.heading > 0 && <span className="marker-count">{site.heading}</span>}
              </button>
            ))}
            <button className="current-location" aria-label="現在地"><span /></button>
            <div className="map-controls">
              <button aria-label="拡大">＋</button>
              <button aria-label="縮小">−</button>
            </div>
            <button className="recenter"><span>⌖</span> このエリアを再検索</button>
            <div className="map-legend">
              <span><i className="is-open" />空きあり</span>
              <span><i className="is-medium" />やや混雑</span>
              <span><i className="is-busy" />混雑</span>
            </div>
            <div className="map-credit">© OpenStreetMap contributors</div>
          </div>

          {detailOpen && (
            <aside className="detail-panel">
              <button className="close-detail" onClick={() => setDetailOpen(false)} aria-label="詳細を閉じる">×</button>
              <div className="detail-scroll">
                <div className="eyebrow"><span className={`status-dot ${statusClass[selected.status]}`} /> {selected.status}</div>
                <h1>{selected.name}</h1>
                <p className="address">{selected.address}</p>
                <button className="route-link">ルートを表示 <span>↗</span></button>

                <div className="spec-grid">
                  <div><span>ストール数</span><strong>{selected.stalls}<small>基</small></strong></div>
                  <div><span>最大出力</span><strong>{selected.power}<small>kW</small></strong></div>
                  <div><span>利用対象</span><strong className="small-value">Tesla</strong></div>
                </div>

                <section className="crowd-card">
                  <div className="section-title"><div><span className="pulse-dot" />アプリ利用状況</div><small>{selected.updated} 更新</small></div>
                  <div className="crowd-numbers">
                    <div><span>向かっている</span><strong>{selected.heading}<small>台</small></strong></div>
                    <div><span>15分以内に到着</span><strong>{selected.eta15}<small>台</small></strong></div>
                    <div><span>充電中</span><strong>{selected.charging}<small>台</small></strong></div>
                  </div>
                  <p className="privacy-note"><span>ⓘ</span> Charge Scout利用者の匿名集計です。Tesla全体の台数ではありません。</p>
                </section>

                <section className="arrival-section">
                  <div className="section-title"><div>到着予定の内訳</div></div>
                  <div className="arrival-row"><span>〜15分</span><div className="bar"><i style={{ width: `${Math.max(8, selected.eta15 * 22)}%` }} /></div><strong>{selected.eta15}</strong></div>
                  <div className="arrival-row"><span>15〜30分</span><div className="bar"><i style={{ width: `${Math.max(5, (selected.heading - selected.eta15) * 18)}%` }} /></div><strong>{Math.max(0, selected.heading - selected.eta15)}</strong></div>
                  <div className="arrival-row"><span>30分〜</span><div className="bar"><i style={{ width: "4%" }} /></div><strong>0</strong></div>
                </section>
              </div>

              <div className="detail-action">
                {registered ? (
                  <div className="registered-state"><span>✓</span><div><strong>向かっています</strong><small>到着予定：約{eta}後</small></div><button onClick={() => setRegistered(false)}>取消</button></div>
                ) : (
                  <button className="go-button" onClick={() => setModalOpen(true)}><span>➤</span> この施設へ向かう</button>
                )}
                <p>Tesla連携後は到着・充電開始を自動判定できます</p>
              </div>
            </aside>
          )}
        </div>
      </section>

      {modalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setModalOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="intent-title">
            <button className="modal-close" onClick={() => setModalOpen(false)}>×</button>
            <div className="modal-icon">➤</div>
            <p className="modal-kicker">目的地を登録</p>
            <h2 id="intent-title">{selected.name}へ向かう</h2>
            <label>利用する車両<select value={vehicle} onChange={(event) => setVehicle(event.target.value)}><option>Model 3 · 72%</option><option>Model Y · 48%</option></select></label>
            <fieldset><legend>到着予定</legend><div className="eta-options">{["15分", "30分", "45分", "60分"].map((time) => <button type="button" key={time} className={eta === time ? "active" : ""} onClick={() => setEta(time)}>{time}</button>)}</div></fieldset>
            <button className="confirm-button" onClick={() => { setRegistered(true); setModalOpen(false); }}>登録して出発する</button>
            <p className="modal-note">登録は3時間後に自動で終了します。正確な車両位置は他の利用者には表示されません。</p>
          </div>
        </div>
      )}

      {connectOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setConnectOpen(false)}>
          <div className="modal connect-modal" role="dialog" aria-modal="true">
            <button className="modal-close" onClick={() => setConnectOpen(false)}>×</button>
            <div className="tesla-connect-mark">T</div>
            <p className="modal-kicker">TESLA FLEET API</p>
            <h2>Teslaと安全に連携</h2>
            <p className="connect-copy">Tesla公式ページでログインします。パスワードがCharge Scoutに共有されることはありません。</p>
            <div className="permission-list"><span>✓ 車両とバッテリー状態</span><span>✓ 許可時のみ車両位置</span><span>✓ いつでも連携解除</span></div>
            <button className="confirm-button" onClick={() => setConnectOpen(false)}>Tesla公式ページへ進む <span>↗</span></button>
            <p className="modal-note">これはデモ画面です。実運用にはTesla Partner登録とOAuth設定が必要です。</p>
          </div>
        </div>
      )}
    </main>
  );
}
