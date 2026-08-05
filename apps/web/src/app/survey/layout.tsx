import type { Metadata, Viewport } from "next";
import { SurveyScrollUnlock } from "./survey-scroll-unlock";

export const metadata: Metadata = {
  title: "Survey",
  description: "Guided site capture, Blake assistance and AI estimate packs.",
  applicationName: "Survey",
  manifest: "/api/manifest/survey",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Survey",
  },
  icons: {
    icon: [{ url: "/api/branding/assets/icon", sizes: "512x512", type: "image/png" }],
    apple: [{ url: "/api/branding/assets/icon", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function SurveyLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <SurveyScrollUnlock />
      {children}
    </>
  );
}
