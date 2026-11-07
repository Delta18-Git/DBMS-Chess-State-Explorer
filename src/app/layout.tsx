import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Chess State Explorer",
  description: "MySQL + Neo4j database for chess opening transpositions and game analytics",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
