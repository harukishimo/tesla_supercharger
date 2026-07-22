"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ShareQrButton } from "@/app/components/share-qr-button";

export default function LandingPage() {
  const [videoOpen, setVideoOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!videoOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVideoOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [videoOpen]);

  return <main className="landing-shell">
    <section className="landing-content" aria-labelledby="landing-title">
      <div className="landing-brand" aria-label="スパQ">
        <span aria-hidden="true">Q</span>
        <strong>スパQ</strong>
      </div>
      <p className="eyebrow">スーパーチャージャーの待ち列</p>
      <h1 id="landing-title">待ち時間を、もっとわかりやすく。</h1>
      <p className="lead">目的の施設を検索して、待ち列と充電の予定を確認できます。</p>
      <Link className="primary-button landing-cta" href="/search">さっそく探す</Link>
      <button className="landing-video-button" type="button" onClick={() => setVideoOpen(true)} aria-haspopup="dialog">
        <span className="play-mark" aria-hidden="true">▶</span>
        使い方を見る
      </button>
      <ShareQrButton className="landing-video-button" />
      <p className="landing-note">表示は参考値です。現地の案内と施設ルールを最優先してください。</p>
      <p className="landing-legal"><Link href="/terms">利用規約</Link><span aria-hidden="true">・</span><Link href="/privacy">プライバシーポリシー</Link></p>
    </section>
    {videoOpen && <div className="video-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setVideoOpen(false); }}>
      <section className="video-modal" role="dialog" aria-modal="true" aria-labelledby="video-modal-title">
        <div className="video-modal-header">
          <div><p className="eyebrow">スパQの使い方</p><h2 id="video-modal-title">待ち列の流れを見る</h2></div>
          <button ref={closeButtonRef} className="video-modal-close" type="button" onClick={() => setVideoOpen(false)} aria-label="動画を閉じる">×</button>
        </div>
        <video className="video-player" controls autoPlay muted playsInline preload="metadata">
          <source src="/charge-queue-mock.mp4" type="video/mp4" />
          お使いのブラウザでは動画を再生できません。
        </video>
        <p className="video-modal-note">施設検索から待ち列への参加、充電完了までの流れを確認できます。</p>
      </section>
    </div>}
  </main>;
}
