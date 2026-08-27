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
    // Survey/Takeoff uploads go through proxy.ts. Cap closer to server-side limits
    // so Render/AWS starter memory is not pinned by 300MB buffered bodies.
    proxyClientMaxBodySize: "50mb",
    serverActions: {
      bodySizeLimit: "40mb",
    },
  },
  transpilePackages: ["@hubflo/domain"],
  async redirects() {
    return [
      // Keep /engineer app available for Core stop/go + gas service record trial.
      // Field app stays at /field.
    ];
  },
};

export default nextConfig;
