"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export function ShareQrButton({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const selector = "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(selector));
    (focusables()[0] ?? dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); return; }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) { event.preventDefault(); dialog.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [open]);

  return <>
    <button className={className} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <span className="share-mark" aria-hidden="true">▦</span>
      知らなかった人に共有する
    </button>
    {open && <div className="share-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
      <section ref={dialogRef} className="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-modal-title" tabIndex={-1}>
        <button className="share-modal-close" type="button" onClick={() => setOpen(false)} aria-label="共有画面を閉じる">×</button>
        <p className="eyebrow">スパQを共有</p>
        <h2 id="share-modal-title">待っている方にも教える</h2>
        <p className="share-modal-lead">このQRコードを、スパQを知らない方に読み取ってもらってください。</p>
        <div className="share-qr-frame">
          <Image src="/share-supa-q-qr.png" alt="スパQを開くQRコード" width={216} height={216} unoptimized />
        </div>
        <p className="share-modal-note">待ち時間は参考値です。現地の並びと施設ルールを最優先してください。</p>
      </section>
    </div>}
  </>;
}
