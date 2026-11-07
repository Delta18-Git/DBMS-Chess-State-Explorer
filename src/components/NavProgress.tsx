"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/** Thin bar at the top while an in-app link is loading (instant feedback on every click). */
export function NavProgress() {
  const path = usePathname();
  const search = useSearchParams();
  const [busy, setBusy] = useState(false);
  useEffect(() => setBusy(false), [path, search]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as HTMLElement).closest("a");
      const row = (e.target as HTMLElement).closest("tr.link");
      if (a) {
        const url = new URL(a.href, location.href);
        if (url.origin === location.origin && a.target !== "_blank" && url.pathname + url.search !== location.pathname + location.search) setBusy(true);
      } else if (row) setBusy(true);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return busy ? <div className="progress" aria-hidden /> : null;
}
