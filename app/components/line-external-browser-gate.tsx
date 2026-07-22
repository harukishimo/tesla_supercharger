"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

const subscribeBrowser = () => () => undefined;
const getExternalUrl = () => {
  if (!/\bLine\//iu.test(navigator.userAgent)) return null;
  const url = new URL(window.location.href);
  url.searchParams.set("openExternalBrowser", "1");
  return url.toString();
};

export function LineExternalBrowserGate() {
  const externalUrl = useSyncExternalStore(subscribeBrowser, getExternalUrl, () => null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!externalUrl) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.querySelector<HTMLElement>("a[href]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") event.preventDefault();
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [externalUrl]);

  if (!externalUrl) return null;

  return <div className="install-modal-backdrop" role="presentation">
    <section ref={dialogRef} className="install-modal" role="dialog" aria-modal="true" aria-labelledby="line-browser-title" tabIndex={-1}>
      <p className="eyebrow">LINEで開いています</p>
      <h2 id="line-browser-title">Safari／Chromeで開いてください</h2>
      <p className="install-modal-lead">ホーム画面への追加と通知を正しく利用するため、端末のブラウザへ移動します。</p>
      <a className="primary-button install-external-link" href={externalUrl}>ブラウザで開く</a>
      <p className="install-modal-note">開かない場合は、LINE右上のメニューから「デフォルトのブラウザで開く」を選択してください。</p>
    </section>
  </div>;
}
