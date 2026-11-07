"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/** A table row that opens `href` when clicked anywhere (links and buttons inside keep their own behaviour). */
export function RowLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  const open = (e: React.MouseEvent | React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("a, button, input, select, form")) return;
    if ("metaKey" in e && (e.metaKey || e.ctrlKey)) { window.open(href, "_blank"); return; }
    router.push(href);
  };
  return (
    <tr className={`link ${className}`} tabIndex={0} onClick={open} onKeyDown={e => { if (e.key === "Enter") open(e); }}>
      {children}
    </tr>
  );
}
