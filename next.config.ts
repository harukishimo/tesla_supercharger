import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    const developmentEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=()" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "style-src 'self' 'unsafe-inline'",
            `script-src 'self' 'unsafe-inline'${developmentEval} https://challenges.cloudflare.com https://cdn.onesignal.com`,
            "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://onesignal.com https://*.onesignal.com https://challenges.cloudflare.com",
            "frame-src https://challenges.cloudflare.com",
            "worker-src 'self' blob:",
          ].join("; "),
        },
      ],
    }];
  },
};

export default nextConfig;
