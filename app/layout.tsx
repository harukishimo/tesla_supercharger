import type { Metadata } from "next";
import Script from "next/script";
import { LineExternalBrowserGate } from "@/app/components/line-external-browser-gate";
import "./globals.css";

export function generateMetadata(): Metadata {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/u, "") || "http://localhost:3000";
  const socialImage = `${configuredOrigin}/og.png`;
  const title = "スパQ | スーパーチャージャー待ち列";
  const description = "スーパーチャージャーの待ち列を確認し、順番と充電予定を共有するWebアプリ。";

  return {
    title,
    description,
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: "/favicon.svg?v=2", type: "image/svg+xml" },
        { url: "/favicon-32.png?v=2", type: "image/png", sizes: "32x32" },
      ],
      shortcut: [{ url: "/favicon.svg?v=2", type: "image/svg+xml" }],
      apple: [{ url: "/apple-touch-icon.png?v=2", type: "image/png", sizes: "180x180" }],
    },
    appleWebApp: { capable: true, statusBarStyle: "default", title: "スパQ" },
    openGraph: { title, description, images: [{ url: socialImage, width: 1728, height: 904 }] },
    twitter: { card: "summary_large_image", title, description, images: [socialImage] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const oneSignalAppId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return <html lang="ja"><body>{children}<LineExternalBrowserGate />{oneSignalAppId ? <Script src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js" strategy="afterInteractive" /> : null}{turnstileSiteKey ? <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" /> : null}</body></html>;
}
