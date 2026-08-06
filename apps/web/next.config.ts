import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.233"],
  // Core UI is still a very large page.tsx; full `tsc` on Render starter
  // regularly exceeds the 15-minute build limit. Keep shippable deploys and
  // run `pnpm typecheck` separately when changing types.
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // Survey/Takeoff uploads go through proxy.ts; keep the buffered body large enough for phone photos.
    proxyClientMaxBodySize: "300mb",
    serverActions: {
      bodySizeLimit: "50mb",
    },
    // Tree-shake lucide icon imports in the Core mega-page.
    optimizePackageImports: ["lucide-react"],
  },
  transpilePackages: ["@hubflo/domain"],
  async redirects() {
    return [
      // Keep /engineer app available for Core stop/go + gas service record trial.
      // Field app stays at /field.
    ];
  },
  async rewrites() {
    // Rewrites (not redirects): Safari often ignores favicon redirects.
    return [
      { source: "/favicon.ico", destination: "/api/branding/favicon?size=32" },
      { source: "/icon.png", destination: "/api/branding/favicon?size=32" },
      { source: "/apple-icon.png", destination: "/api/branding/favicon?size=180" },
    ];
  },
};

export default nextConfig;
