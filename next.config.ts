import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build enxuto para rodar em Docker (Railway, Render, Fly.io ou VPS).
  output: "standalone",
  poweredByHeader: false,
  // Painel no computador em painel.localhost:3000 (site em localhost:3000).
  allowedDevOrigins: ["painel.localhost", "*.localhost"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
