import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.233"],
  experimental: {
    proxyClientMaxBodySize: "300mb",
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
