import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.233"],
  experimental: {
    proxyClientMaxBodySize: "300mb",
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
