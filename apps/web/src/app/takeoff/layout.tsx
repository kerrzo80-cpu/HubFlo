import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "NeXa Takeoffs",
  description: "NeXa takeoff workspace for drawings, BOQs, measurements and supplier requests.",
  applicationName: "NeXa Takeoffs",
  manifest: "/manifest-takeoffs.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "NeXa Takeoffs",
  },
  icons: {
    icon: [
      { url: "/app-icons/nexa-takeoffs-icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/app-icons/nexa-takeoffs-icon-1024.png", sizes: "1024x1024", type: "image/png" },
    ],
    apple: [{ url: "/app-icons/nexa-takeoffs-apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function TakeoffLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
