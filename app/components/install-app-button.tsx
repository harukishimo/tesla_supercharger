"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type InstallChoice = { outcome: "accepted" | "dismissed"; platform: string };
type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<InstallChoice>;
};

type DeviceKind = "android" | "ios" | "desktop";
type DialogKind = "android-help" | "ios-help" | "desktop-help" | null;

declare global {
  interface Navigator { standalone?: boolean }
}

const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const subscribeDevice = () => () => undefined;
const getClientDevice = () => getDeviceKind(navigator.userAgent);
const getServerDevice = (): DeviceKind => "desktop";
const subscribeStandalone = (onChange: () => void) => {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", onChange);
  window.addEventListener("appinstalled", onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("appinstalled", onChange);
  };
};

function getDeviceKind(userAgent: string): DeviceKind {
  if (/android/iu.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/iu.test(userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  return "desktop";
}

export function InstallAppButton({ className }: { className: string }) {
  const device = useSyncExternalStore(subscribeDevice, getClientDevice, getServerDevice);
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [installAccepted, setInstallAccepted] = useState(false);
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallAccepted(true);
      setPromptEvent(null);
      setDialog(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!dialog) return;
    const modal = dialogRef.current;
    if (!modal) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const selector = "button:not([disabled]), a[href], video[controls], [tabindex]:not([tabindex='-1'])";
    const focusables = () => Array.from(modal.querySelectorAll<HTMLElement>(selector));
    (focusables()[0] ?? modal).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDialog(null); return; }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) { event.preventDefault(); modal.focus(); return; }
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    modal.addEventListener("keydown", onKeyDown);
    return () => {
      modal.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [dialog]);

  const buttonLabel = device === "android" ? "スパQをインストール" : "ホーム画面に追加する";

  const startInstall = async () => {
    if (promptEvent) {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === "accepted") setInstallAccepted(true);
      setPromptEvent(null);
      return;
    }
    setDialog(device === "android" ? "android-help" : device === "ios" ? "ios-help" : "desktop-help");
  };

  if (standalone || installAccepted) return null;

  return <>
    <button className={className} type="button" onClick={() => void startInstall()} aria-haspopup="dialog">
      <span className="install-mark" aria-hidden="true">↓</span>
      {buttonLabel}
    </button>
    {dialog && <div className="install-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setDialog(null); }}>
      <section ref={dialogRef} className="install-modal" role="dialog" aria-modal="true" aria-labelledby="install-modal-title" tabIndex={-1}>
        <button className="install-modal-close" type="button" onClick={() => setDialog(null)} aria-label="案内を閉じる">×</button>
        {dialog === "ios-help" && <>
          <p className="eyebrow">iPhone／iPad</p>
          <h2 id="install-modal-title">Safariからホーム画面に追加</h2>
          <p className="install-modal-lead">Safariで共有ボタンを押し、「ホーム画面に追加」を選択します。</p>
          <video className="install-guide-video" controls autoPlay muted loop playsInline preload="metadata">
            <source src="/ios-home-screen-guide.mp4" type="video/mp4" />
            お使いのブラウザでは動画を再生できません。
          </video>
          <ol className="install-steps"><li>Safariでこのページを開く</li><li>共有ボタンを押す</li><li>「ホーム画面に追加」を選ぶ</li></ol>
        </>}
        {dialog === "android-help" && <>
          <p className="eyebrow">Android</p>
          <h2 id="install-modal-title">Chromeからインストール</h2>
          <p className="install-modal-lead">Chrome右上の「︙」を押し、「アプリをインストール」または「ホーム画面に追加」を選択してください。</p>
          <button className="primary-button" type="button" onClick={() => setDialog(null)}>わかりました</button>
        </>}
        {dialog === "desktop-help" && <>
          <p className="eyebrow">パソコン</p>
          <h2 id="install-modal-title">ブラウザからインストール</h2>
          <p className="install-modal-lead">ChromeまたはEdgeのアドレスバーに表示されるインストールアイコンを選択してください。</p>
          <button className="primary-button" type="button" onClick={() => setDialog(null)}>わかりました</button>
        </>}
      </section>
    </div>}
  </>;
}
