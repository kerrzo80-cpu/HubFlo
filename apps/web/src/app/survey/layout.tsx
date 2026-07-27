import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "NeXa Surveyor",
  description: "NeXa Surveyor for guided site capture, Buddy assistance and AI estimate packs.",
  applicationName: "NeXa Surveyor",
  manifest: "/manifest-estimator.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "NeXa Surveyor",
  },
  icons: {
    icon: [
      { url: "/app-icons/nexa-estimator-icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/app-icons/nexa-estimator-icon-1024.png", sizes: "1024x1024", type: "image/png" },
    ],
    apple: [{ url: "/app-icons/nexa-estimator-apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function SurveyLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
