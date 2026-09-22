import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Trang cong khai /baogia/{token} duoc route tu domain chinh (getcloudgate.com)
  // qua NPM sang stack CRM nay (crm.getcloudgate.com) - xem modules/quotes/
  // utils/publicQuoteUrl.ts. assetPrefix bat buoc JS/CSS (_next/static) luon
  // tai TUYET DOI tu crm.getcloudgate.com du HTML dang mo o domain nao -
  // tranh dung chung "/_next/" voi app Next.js rieng cua domain chinh (se
  // 404 neu de path tuong doi). Dung lai bien CRM_PUBLIC_URL (NEXT_PUBLIC_
  // LINKEDIN_CRAWLER_API_URL) da co san - khong doi hanh vi luc dung binh
  // thuong o crm.getcloudgate.com vi no tu tro ve chinh no.
  assetPrefix: process.env.NEXT_PUBLIC_LINKEDIN_CRAWLER_API_URL || undefined,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "/**",
      },
    ],
  },
  async rewrites() {
    if (process.env.ENABLE_NEXT_REWRITE === '1') {
      return [
        {
          source: "/api/:path*",
          destination: "http://127.0.0.1:8000/api/:path*",
        },
      ];
    }
    return [];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
      // Fonts/JS/CSS o /_next/static duoc trang /baogia/{token} tren domain
      // chinh (getcloudgate.com) tai TUYET DOI tu day (xem assetPrefix o
      // tren). Next.js tu gan crossorigin="" cho <link rel="preload"
      // as="font"> -> trinh duyet BAT BUOC response co Access-Control-
      // Allow-Origin moi dung duoc font, du HTTP van tra 200 (loi thuc te da
      // gap: font bi CORS chan -> page crash "Cannot read properties of
      // null"). Asset build tinh, cong khai, khong co cookie/du lieu nhay
      // cam nen an toan cho phep moi origin (giong CDN).
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default nextConfig;
