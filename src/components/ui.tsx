import Link from "next/link";
import type { ReactNode } from "react";

export const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
export const pct = (v: unknown, digits = 0) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(digits)}%`);
export const pawns = (cp: unknown) => {
  if (cp === null || cp === undefined) return "—";
  const v = Number(cp) / 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
};
export const resultLabel: Record<string, string> = { "1-0": "1–0", "0-1": "0–1", "1/2-1/2": "½–½", "*": "*" };

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {children}
    </div>
  );
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return <div className="stat"><div className="stat-label">{label}</div><div className="stat-value">{value}</div>{note && <div className="stat-note">{note}</div>}</div>;
}

/** Offset pager driven by the URL; shows "next" when a full page came back. */
export function Pager({ base, params, offset, limit, count }: { base: string; params: Record<string, string | undefined>; offset: number; limit: number; count: number }) {
  const href = (o: number) => {
    const s = new URLSearchParams(Object.entries({ ...params, offset: String(o) }).filter(([, v]) => v) as [string, string][]);
    return `${base}?${s}`;
  };
  if (offset === 0 && count < limit) return null;
  return (
    <div className="pager small">
      {offset > 0 ? <Link className="btn btn-ghost" href={href(Math.max(0, offset - limit))}>← Previous</Link> : null}
      <span className="muted">{offset + 1}–{offset + count}</span>
      {count === limit ? <Link className="btn btn-ghost" href={href(offset + limit)}>Next →</Link> : null}
    </div>
  );
}

export function ResultBar({ w, d, b }: { w: number; d: number; b: number }) {
  const total = w + d + b;
  if (!total) return <span className="muted small">no results</span>;
  return (
    <div className="resultbar" role="img" aria-label={`White wins ${w}, draws ${d}, black wins ${b}`}>
      {w > 0 && <i className="r-w" style={{ flex: w }} title={`White wins: ${w}`} />}
      {d > 0 && <i className="r-d" style={{ flex: d }} title={`Draws: ${d}`} />}
      {b > 0 && <i className="r-b" style={{ flex: b }} title={`Black wins: ${b}`} />}
    </div>
  );
}

export function ResultLegend() {
  return <div className="legend"><span><i className="swatch swatch-s1" /> White wins</span><span><i className="swatch swatch-s2" /> Draws</span><span><i className="swatch swatch-s3" /> Black wins</span></div>;
}

export function Db({ kind }: { kind: "MySQL" | "Neo4j" }) {
  return <span className={`db-tag db-${kind.toLowerCase()}`} title={`Served by ${kind}`}>{kind}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
