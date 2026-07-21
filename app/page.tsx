"use client";

import { useEffect, useState } from "react";

type Screen = "search" | "station" | "join" | "waiting" | "soon" | "turn" | "duration" | "charging" | "complete";

const stations = [
  { id: 1, name: "東京 有明", address: "江東区有明2丁目", distance: "1.4 km", wait: 25, ahead: 3, stalls: "8 / 8", tone: "busy" },
  { id: 2, name: "東京 六本木", address: "港区六本木6丁目", distance: "6.8 km", wait: 10, ahead: 1, stalls: "6 / 6", tone: "medium" },
  { id: 3, name: "川崎", address: "川崎市幸区堀川町", distance: "14.2 km", wait: 0, ahead: 0, stalls: "6 / 8", tone: "open" },
];

const flow: Screen[] = ["search", "station", "join", "waiting", "soon", "turn", "duration", "charging", "complete"];

export default function Home() {
  const [screen, setScreen] = useState<Screen>("search");
  const [nickname, setNickname] = useState("");
  const [duration, setDuration] = useState(30);
  const [seconds, setSeconds] = useState(299);

  useEffect(() => {
    if (screen !== "turn") return;
    const timer = window.setInterval(() => setSeconds((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [screen]);

  const reset = () => {
    setScreen("search");
    setNickname("");
    setDuration(30);
    setSeconds(299);
  };

  const advanceDemo = () => {
    const index = flow.indexOf(screen);
    if (screen === "complete") reset();
    else setScreen(flow[Math.min(index + 1, flow.length - 1)]);
  };

  const countdown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <main className="mock-stage">
      <div className="video-title">
        <span>PRODUCT MOCK</span>
        <h1>スーパーチャージャー待ち列</h1>
        <p>着いてから、充電を終えるまで。</p>
      </div>

      <section className="phone" aria-label="スーパーチャージャー待ち列アプリのMock">
        <div className="phone-bar"><span>9:41</span><div className="phone-sensors"><i /><i /><b /></div></div>

        <header className="app-header">
          {screen !== "search" && screen !== "complete" ? (
            <button className="back-button" onClick={() => setScreen(screen === "station" ? "search" : "station")} aria-label="戻る">‹</button>
          ) : <span className="header-spacer" />}
          <div className="app-brand"><span className="app-logo">Q</span><strong>Charge Queue</strong></div>
          <span className="mock-pill">MOCK</span>
        </header>

        <div className="app-content">
          {screen === "search" && (
            <div className="screen search-screen">
              <div className="intro">
                <p className="overline">NEARBY SUPERCHARGERS</p>
                <h2>近くの充電スポット</h2>
                <p>待ち時間を確認して、到着した施設の列に並べます。</p>
              </div>
              <div className="search-box"><span>⌕</span><input aria-label="施設を検索" defaultValue="現在地の近く" readOnly /><button>現在地</button></div>
              <div className="result-label"><strong>近い順</strong><span>3件</span></div>
              <div className="station-list">
                {stations.map((station) => (
                  <button key={station.id} className="station-card" onClick={() => setScreen("station")} data-testid={station.id === 1 ? "nearest-station" : undefined}>
                    <div className="station-top"><span className={`availability ${station.tone}`}><i />{station.tone === "open" ? "空きあり" : "満車"}</span><strong>{station.distance}</strong></div>
                    <h3>{station.name}</h3><p>{station.address}</p>
                    <div className="station-metrics"><span><b>{station.stalls}</b><small>使用中</small></span><span><b>{station.wait === 0 ? "なし" : `約${station.wait}分`}</b><small>待ち時間</small></span><span><b>{station.ahead}人</b><small>待ち列</small></span></div>
                    <span className="card-arrow">›</span>
                  </button>
                ))}
              </div>
              <p className="list-note">待ち時間は利用者の入力をもとにした目安です。</p>
            </div>
          )}

          {screen === "station" && (
            <div className="screen station-screen">
              <div className="station-hero">
                <span className="availability busy"><i />現在満車</span>
                <h2>東京 有明</h2><p>東京都江東区有明2丁目</p>
                <div className="distance-row"><span>現在地から 1.4 km</span><button>Google Maps ↗</button></div>
              </div>
              <div className="queue-summary">
                <p>現在の待ち状況</p>
                <div><span><strong>3</strong>人<small>待っています</small></span><span><strong>約25</strong>分<small>待ち時間の目安</small></span></div>
              </div>
              <div className="stall-row"><div><span className="stall-icon">ϟ</span><p><strong>8ストール</strong><small>すべて使用中</small></p></div><span>250 kW</span></div>
              <div className="how-card"><strong>並んだあとの流れ</strong><ol><li><span>1</span>順番と待ち時間をこの画面で確認</li><li><span>2</span>順番の5分前に画面でお知らせ</li><li><span>3</span>呼ばれたら5分以内に充電開始</li></ol></div>
              <button className="primary-button" data-testid="join-queue" onClick={() => setScreen("join")}>この待ち列に参加する</button>
              <p className="button-note">参加に必要なのはニックネームだけです</p>
            </div>
          )}

          {screen === "join" && (
            <div className="screen join-screen">
              <div className="modal-art"><span>4</span></div>
              <p className="overline">JOIN THE QUEUE</p><h2>待ち列に参加</h2>
              <p className="screen-lead">あなたを見分けるためのニックネームを入力してください。</p>
              <label className="field-label" htmlFor="nickname">ニックネーム</label>
              <input id="nickname" className="nickname-input" data-testid="nickname" placeholder="例：白いModel 3" value={nickname} onChange={(event) => setNickname(event.target.value)} autoFocus />
              <div className="privacy-box"><span>◌</span><p><strong>電話番号は不要です</strong><small>今回はSMS通知を使わず、この画面で順番をお知らせします。</small></p></div>
              <div className="join-preview"><span>あなたの順番</span><strong>4番目</strong><span>待ち時間</span><strong>約25分</strong></div>
              <button className="primary-button" data-testid="confirm-join" disabled={!nickname.trim()} onClick={() => setScreen("waiting")}>参加する</button>
              <button className="text-button" onClick={() => setScreen("station")}>キャンセル</button>
            </div>
          )}

          {screen === "waiting" && <QueueStatus nickname={nickname || "白いModel 3"} ahead={3} minutes={25} tone="waiting" onLeave={reset} />}
          {screen === "soon" && <QueueStatus nickname={nickname || "白いModel 3"} ahead={1} minutes={5} tone="soon" onLeave={reset} />}

          {screen === "turn" && (
            <div className="screen turn-screen">
              <div className="turn-rings"><div><span>あなたの</span><strong>番です!</strong></div></div>
              <h2>充電を開始してください</h2><p>空いたストールへ移動し、<br />ケーブルを接続してください。</p>
              <div className="limit-card"><span>受付の残り時間</span><strong>{countdown}</strong><small>5分を過ぎると待ち列から自動で削除されます</small></div>
              <button className="primary-button pulse-button" data-testid="started-charging" onClick={() => setScreen("duration")}><span>ϟ</span>充電を開始しました！</button>
              <button className="text-button danger-text" onClick={reset}>充電できないので列を抜ける</button>
            </div>
          )}

          {screen === "duration" && (
            <div className="screen duration-screen">
              <div className="charging-icon">ϟ</div><p className="overline">CHARGING STARTED</p><h2>あと何分充電しますか？</h2>
              <p className="screen-lead">次の人の待ち時間を計算するため、予定を教えてください。あとから変更できます。</p>
              <div className="duration-options">{[20, 30, 40, 50].map((value) => <button key={value} data-testid={value === 30 ? "duration-30" : undefined} className={duration === value ? "selected" : ""} onClick={() => setDuration(value)}><strong>{value}</strong><small>分</small></button>)}</div>
              <div className="finish-estimate"><span>終了予定</span><strong>10:{11 + duration}</strong></div>
              <button className="primary-button" data-testid="confirm-duration" onClick={() => setScreen("charging")}>この時間で開始</button>
            </div>
          )}

          {screen === "charging" && (
            <div className="screen charging-screen">
              <div className="charging-orbit"><span>ϟ</span></div><span className="live-label"><i />充電中</span>
              <h2>充電しています</h2><p>東京 有明 · ストール 04</p>
              <div className="remaining-time"><span>終了予定まで</span><strong>{duration - 1}<small>分</small> 48<small>秒</small></strong><div><i style={{ width: "42%" }} /></div><small>10:{11 + duration}ごろ終了予定</small></div>
              <div className="charge-stats"><span><strong>46%</strong><small>バッテリー</small></span><span><strong>171 kW</strong><small>充電速度</small></span></div>
              <button className="secondary-button" data-testid="finish-charging" onClick={() => setScreen("complete")}>充電が終わりました</button>
              <button className="text-button">充電時間を変更</button>
            </div>
          )}

          {screen === "complete" && (
            <div className="screen complete-screen">
              <div className="complete-check"><span>✓</span></div><p className="overline">CHARGE COMPLETE</p><h2>充電完了、おつかれさまでした</h2>
              <p>待ち列から退出しました。<br />次の方に順番をお知らせしています。</p>
              <div className="thanks-card"><span>今回の充電時間</span><strong>28分</strong><span>次の人の待ち時間</span><strong>約15分</strong></div>
              <button className="primary-button" onClick={reset}>近くの充電スポットへ</button>
              <p className="safe-drive">Have a safe drive.</p>
            </div>
          )}
        </div>

        {(screen === "waiting" || screen === "soon") && <button className="demo-next" data-testid="advance-demo" onClick={advanceDemo}><span>MOCK</span> 時間を進める →</button>}
        <div className="home-indicator" />
      </section>

      <aside className="flow-rail" aria-label="Mockの流れ">
        <p>FLOW</p>
        {["近くの施設を選ぶ", "ニックネームで参加", "順番を待つ", "5分前のお知らせ", "充電開始・完了"].map((item, index) => {
          const activeIndex = screen === "search" || screen === "station" ? 0 : screen === "join" ? 1 : screen === "waiting" ? 2 : screen === "soon" ? 3 : 4;
          return <div key={item} className={index <= activeIndex ? "active" : ""}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item}</strong></div>;
        })}
      </aside>
    </main>
  );
}

function QueueStatus({ nickname, ahead, minutes, tone, onLeave }: { nickname: string; ahead: number; minutes: number; tone: "waiting" | "soon"; onLeave: () => void }) {
  return <div className={`screen queue-screen ${tone}`}>
    {tone === "soon" && <div className="notice-banner"><span>!</span><p><strong>まもなく順番です</strong><small>5分以内に施設へお戻りください</small></p></div>}
    <p className="overline">YOUR QUEUE</p><h2>{nickname}<small>さん</small></h2>
    <div className="position-orbit"><span>現在</span><strong>{ahead + 1}</strong><small>番目</small></div>
    <div className="queue-facts"><div><span>あなたの前</span><strong>{ahead}<small>人</small></strong></div><div><span>待ち時間の目安</span><strong>{minutes}<small>分</small></strong></div></div>
    <div className="queue-progress"><div><i style={{ width: tone === "soon" ? "82%" : "28%" }} /></div><p><span>参加</span><span>あと{tone === "soon" ? "少し" : "約25分"}</span><span>あなたの番</span></p></div>
    <div className="stay-card"><span>{tone === "soon" ? "⌖" : "☕"}</span><p><strong>{tone === "soon" ? "施設の近くでお待ちください" : "車内や施設内でお待ちください"}</strong><small>{tone === "soon" ? "順番になると5分の受付時間が始まります。" : "画面を閉じても列には残ります。順番の5分前にお知らせします。"}</small></p></div>
    <button className="leave-button" onClick={onLeave}>待ち列から抜ける</button>
  </div>;
}
