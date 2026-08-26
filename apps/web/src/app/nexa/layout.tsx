import { Sora, Source_Sans_3 } from "next/font/google";

const sora = Sora({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-nexa-display",
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-nexa-ui",
});

export default function NexaLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${sora.variable} ${sourceSans.variable}`}>{children}</div>;
}
