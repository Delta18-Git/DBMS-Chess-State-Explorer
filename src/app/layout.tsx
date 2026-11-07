import type { ReactNode } from "react";
import { Archivo, JetBrains_Mono, Source_Sans_3 } from "next/font/google";
import "./globals.css";

const display = Archivo({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display" });
const body = Source_Sans_3({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-mono" });

export const metadata = {
  title: "Chess State Explorer",
  description: "MySQL + Neo4j database for chess opening transpositions and game analytics",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Browser extensions (e.g. Video Speed Controller adds class="vsc-initialized") edit <body>
  // before React hydrates; ignore attribute-only differences on this one element.
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
