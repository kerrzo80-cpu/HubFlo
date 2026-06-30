import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NeXa",
  description: "Bound into one command center for service operations.",
  icons: {
    icon: "/brand/nexa-favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
