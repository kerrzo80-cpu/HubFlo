import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Estimator",
  description: "Site survey chat, room scans, heat loss and quote handoff.",
  applicationName: "Estimator",
  manifest: "/api/manifest/estimator",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Estimator",
  },
  icons: {
    icon: [
      { url: "/icon", sizes: "32x32", type: "image/png" },
      { url: "/api/branding/assets/logo-survey?home=1&v=tab1", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/api/branding/assets/logo-survey?apple=1&v=tab1", sizes: "180x180", type: "image/png" }],
  },
};

export default function EstimatorLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
