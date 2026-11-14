import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["pg-boss", "postgres"],
  turbopack: { root: import.meta.dirname },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.dzcdn.net" },
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "*.spotifycdn.com" },
      { protocol: "https", hostname: "mosaic.scdn.co" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] }];
  },
};

export default config;
