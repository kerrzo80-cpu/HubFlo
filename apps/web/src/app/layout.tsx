import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HubFlo",
  description: "Work, job and service operations in one controlled flow.",
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
