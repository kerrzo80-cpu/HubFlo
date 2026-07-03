import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.233"],
  experimental: {
    proxyClientMaxBodySize: "300mb",
  },
  transpilePackages: ["@hubflo/domain"],
};

export default nextConfig;
