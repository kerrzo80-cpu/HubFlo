import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.233"],
  // Keep pdfjs out of the server bundle — bundling breaks its internal worker/chunk
  // imports (Render: Cannot find module …/depth_pdf_*/chunk-…).
  serverExternalPackages: ["pdfjs-dist"],
  experimental: {
    // Survey/Takeoff uploads go through proxy.ts; keep the buffered body large enough for phone photos.
    proxyClientMaxBodySize: "300mb",
    serverActions: {
      bodySizeLimit: "300mb",
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

const sentryBuildConfigured = Boolean(
  process.env.SENTRY_ORG && process.env.SENTRY_PROJECT && process.env.SENTRY_AUTH_TOKEN,
);

export default sentryBuildConfigured
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      widenClientFileUpload: true,
    })
  : nextConfig;
