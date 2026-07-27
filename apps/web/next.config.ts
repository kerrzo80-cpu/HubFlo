import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.233"],
  experimental: {
    // Survey/Takeoff uploads go through proxy.ts; keep the buffered body large enough for phone photos.
    proxyClientMaxBodySize: "300mb",
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  transpilePackages: ["@hubflo/domain"],
};

export default nextConfig;
