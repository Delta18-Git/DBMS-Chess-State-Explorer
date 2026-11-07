"use client";

import { useRouter, usePathname } from "next/navigation";
import { useRef, type ReactNode } from "react";

/** GET filter form that applies itself as soon as a select changes (text inputs apply on Enter). */
export function AutoForm({ children, className = "filters" }: { children: ReactNode; className?: string }) {
  const router = useRouter();
  const path = usePathname();
  const ref = useRef<HTMLFormElement>(null);
  const apply = () => {
    const fd = new FormData(ref.current!);
    const params = new URLSearchParams();
    for (const [k, v] of fd) if (typeof v === "string" && v.trim()) params.set(k, v.trim());
    const q = params.toString();
    router.push(q ? `${path}?${q}` : path, { scroll: false });
  };
  return (
    <form ref={ref} className={className} onSubmit={e => { e.preventDefault(); apply(); }}
      onChange={e => { if ((e.target as HTMLElement).tagName === "SELECT") apply(); }}>
      {children}
    </form>
  );
}
