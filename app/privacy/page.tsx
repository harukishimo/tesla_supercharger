import Link from "next/link";

export default function PrivacyPage() {
  return <main className="legal-page"><Link href="/">← スパQ</Link><h1>プライバシーポリシー</h1><p>最終更新日：2026年7月22日</p><h2>1. 取得する情報</h2><p>待ち列の利用中は、ニックネーム、待ち列の状態、ブラウザで生成した管理トークンのハッシュを処理します。通知を許可した場合は、OneSignalの匿名Push Subscription IDを通知送信のために処理します。</p><h2>2. 保存期間</h2><p>待ち列が完了、退出、呼び出し失効、自動完了した時点で、待ち列データとブラウザの管理情報を削除します。利用者履歴やアカウントは作成しません。</p><h2>3. 外部サービス</h2><p>運営者が有効化した場合、Supabase（データベース・Realtime）、Vercel（アプリ実行）、OneSignal（Web Push）、Cloudflare Turnstile（不正利用対策）を利用します。各サービスの保持・処理は、運営者が設定する契約とプライバシー設定に従います。</p><h2>4. 安全管理</h2><p>管理トークンの原文はサーバーへ保存せず、待ち列操作にはトークン照合を必要とします。ブラウザデータを消去すると、自分の待ち列を復旧できなくなる場合があります。</p><h2>5. 問い合わせ</h2><p>運営者情報と問い合わせ先は、本サービスの正式公開時に運営者が設定します。</p><p className="legal-date"><Link href="/terms">利用規約</Link></p></main>;
}
