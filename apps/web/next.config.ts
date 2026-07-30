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
  },
  transpilePackages: ["@hubflo/domain"],
  async redirects() {
    return [
      { source: "/engineer", destination: "/field", permanent: false },
      { source: "/engineer/time-check", destination: "/field/time-check", permanent: false },
      { source: "/engineer/jobs/:scheduleId", destination: "/field/jobs/:scheduleId", permanent: false },
    ];
  },
};

export default nextConfig;
