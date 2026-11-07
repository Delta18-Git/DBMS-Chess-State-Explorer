"use client";

import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

export interface Tab { id: string; label: ReactNode; count?: number | string; content: ReactNode }

/**
 * In-page tabs. The active tab lives in the URL (?tab=…) via history.replaceState, so reloads,
 * back/forward and pagination links keep it, without re-rendering the page on the server.
 */
export function Tabs({ tabs, initial, param = "tab" }: { tabs: Tab[]; initial?: string; param?: string }) {
  const search = useSearchParams();
  const fromUrl = search.get(param);
  const valid = (id: string | null | undefined) => (id && tabs.some(t => t.id === id) ? id : null);
  const [active, setActive] = useState(valid(fromUrl) ?? valid(initial) ?? tabs[0]?.id);
  const pick = (id: string) => {
    setActive(id);
    const params = new URLSearchParams(window.location.search);
    params.set(param, id);
    params.delete("page");
    window.history.replaceState(null, "", `${window.location.pathname}?${params}${window.location.hash}`);
  };
  return (
    <div className="tabs">
      <div className="tabs-bar" role="tablist">
        {tabs.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={active === t.id} onClick={() => pick(t.id)}>
            {t.label}{t.count !== undefined && <span className="count">{t.count}</span>}
          </button>
        ))}
      </div>
      {tabs.map(t => (
        <div key={t.id} role="tabpanel" hidden={active !== t.id} className="tab-panel">{t.content}</div>
      ))}
    </div>
  );
}
