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
    icon: [
      { url: "/api/branding/favicon?size=32&v=tab4", sizes: "32x32", type: "image/png" },
      { url: "/api/branding/assets/logo-survey?home=1&v=compose5", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/api/branding/assets/logo-survey?apple=1&v=compose5", sizes: "180x180", type: "image/png" }],
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
