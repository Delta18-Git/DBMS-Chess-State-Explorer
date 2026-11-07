import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Chess State Explorer",
  description: "MySQL + Neo4j database for chess opening transpositions and game analytics",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Browser extensions (e.g. Video Speed Controller adds class="vsc-initialized") edit <body>
  // before React hydrates; ignore attribute-only differences on this one element.
  return <html lang="en"><body suppressHydrationWarning>{children}</body></html>;
}
