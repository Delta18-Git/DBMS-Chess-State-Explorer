import type { ReactNode } from "react";

export const metadata = { title: "Chess State Explorer API" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
