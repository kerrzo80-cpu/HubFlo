import { Sora, Source_Sans_3 } from "next/font/google";

export const sora = Sora({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-ea-display",
});

export const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-ea-ui",
});
