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
    icon: [{ url: "/api/branding/assets/logo-survey", sizes: "512x512", type: "image/png" }],
    apple: [{ url: "/api/branding/assets/logo-survey", sizes: "180x180", type: "image/png" }],
  },
};

export default function EstimatorLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
