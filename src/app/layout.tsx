import type { ReactNode } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

export const metadata = {
  title: "Chess State Explorer",
  description: "Opening transpositions and game analytics over real tournament games (MySQL + Neo4j)",
};
export const viewport = { width: "device-width", initialScale: 1, themeColor: "#f4f5f7" };

export default function RootLayout({ children }: { children: ReactNode }) {
  // Browser extensions edit <body> attributes before React hydrates; ignore that one element.
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
