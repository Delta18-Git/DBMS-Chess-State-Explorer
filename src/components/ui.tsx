import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { Avatar } from "./Avatar";
export { Avatar };

// ---------- formatting ----------
export const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
export const pct = (v: unknown, digits = 0) => (n(v) === null ? "—" : `${Number(v).toFixed(digits)}%`);
export const pawns = (cp: unknown, mate?: unknown) => {
  if (n(mate) !== null) return `${Number(mate) > 0 ? "" : "-"}M${Math.abs(Number(mate))}`;
  if (n(cp) === null) return "—";
  const v = Number(cp) / 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
};
export const resultLabel: Record<string, string> = { "1-0": "1–0", "0-1": "0–1", "1/2-1/2": "½–½", "*": "*" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDate(d?: string | null, withYear = true) {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return `${day} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}
export function dateRange(a?: string | null, b?: string | null) {
  if (!a) return "—";
  if (!b || a === b) return fmtDate(a);
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  return `${fmtDate(a, !sameYear)} – ${fmtDate(b)}`;
}
/** "3.1" → "Round 3 · board 1" (Lichess broadcast numbering) */
export function roundLabel(r?: string | null, short = false) {
  if (!r) return null;
  const [round, board] = r.split(".");
  return short ? `R${round}${board ? `.${board}` : ""}` : `Round ${round}${board ? ` · board ${board}` : ""}`;
}
export const moveNo = (ply: number) => `${Math.ceil(ply / 2)}${ply % 2 ? "." : "…"}`;
/** FIDE "Carlsen, Magnus" → "Magnus Carlsen" for headings; tables keep the FIDE form. */
export const displayName = (name: string) => (/^[^,]+, [^,]+$/.test(name) ? name.split(", ").reverse().join(" ") : name);
export const initials = (name: string) => displayName(name).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();

// ---------- layout ----------
export function PageHead({ title, lead, crumbs, children }: { title: ReactNode; lead?: ReactNode; crumbs?: [string, string | null][]; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        {crumbs && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map(([label, href], i) => (
              <span key={i} className="row" style={{ gap: 6 }}>
                {i > 0 && <Icon name="next" className="tiny" />}
                {href ? <Link href={href}>{label}</Link> : <span>{label}</span>}
              </span>
            ))}
          </nav>
        )}
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

/** Every admin-only action on a page sits in this dark strip, directly under the page header. */
export function AdminBar({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="admin-bar" role="region" aria-label="Admin tools">
      <span className="admin-tag"><Icon name="key" /> Admin</span>
      {children}
      {hint && <><span className="spacer" /><span className="hint">{hint}</span></>}
    </div>
  );
}

export function Card({ title, sub, actions, children, foot, db, pad = false, id }: {
  title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; foot?: ReactNode; db?: "MySQL" | "Neo4j" | "MySQL + Neo4j" | "Stockfish"; pad?: boolean; id?: string;
}) {
  return (
    <section className="card" id={id}>
      {(title || actions) && (
        <div className="card-head">
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}><h2>{title}</h2>{db && <Db kind={db} />}</div>
            {sub && <div className="sub">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {pad ? <div className="card-body">{children}</div> : children}
      {foot && <div className="card-foot">{foot}</div>}
    </section>
  );
}

export function Stats({ children }: { children: ReactNode }) { return <div className="stats">{children}</div>; }
export function Stat({ label, value, note }: { label: ReactNode; value: ReactNode; note?: ReactNode }) {
  return <div className="stat"><div className="stat-label">{label}</div><div className="stat-value">{value}</div>{note && <div className="stat-note">{note}</div>}</div>;
}

export function Db({ kind }: { kind: string }) {
  return <span className="db" title={`Answered by ${kind}`}>{kind}</span>;
}
export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }

// ---------- pagination: ‹ 1 2 3 … 25 › ----------
export function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, 2, total - 1, total, current - 1, current, current + 1].filter(p => p >= 1 && p <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  sorted.forEach((p, i) => { if (i && p - sorted[i - 1] > 1) out.push("…"); out.push(p); });
  return out;
}
export function Pagination({ base, params, page, perPage, total }: { base: string; params: Record<string, string | undefined>; page: number; perPage: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const href = (p: number) => {
    const s = new URLSearchParams(Object.entries({ ...params, page: p > 1 ? String(p) : undefined }).filter(([, v]) => v) as [string, string][]);
    const q = s.toString();
    return q ? `${base}?${q}` : base;
  };
  const from = total ? (page - 1) * perPage + 1 : 0, to = Math.min(total, page * perPage);
  return (
    <div className="pager">
      <span className="small muted">{total ? `${from}–${to} of ${total.toLocaleString("en")}` : "No results"}</span>
      {pages > 1 && (
        <nav className="pages" aria-label="Pages">
          {page > 1 ? <Link href={href(page - 1)} scroll={false} aria-label="Previous page"><Icon name="prev" /></Link> : <span className="disabled"><Icon name="prev" /></span>}
          {pageWindow(page, pages).map((p, i) => p === "…" ? <span key={`g${i}`} className="gap">…</span>
            : p === page ? <span key={p} className="current" aria-current="page">{p}</span> : <Link key={p} href={href(p)} scroll={false}>{p}</Link>)}
          {page < pages ? <Link href={href(page + 1)} scroll={false} aria-label="Next page"><Icon name="next" /></Link> : <span className="disabled"><Icon name="next" /></span>}
        </nav>
      )}
    </div>
  );
}
export const pageOf = (sp: { page?: string }) => Math.max(1, Math.floor(Number(sp.page) || 1));
export const totalOf = (rows: { total_rows?: unknown }[]) => Number(rows[0]?.total_rows ?? 0);

// ---------- sortable table headers (click to sort, click again to reverse) ----------
export function SortTh({ label, col, base, params, sort, dir, defaultDir = "desc", className = "", title }: {
  label: ReactNode; col: string; base: string; params: Record<string, string | undefined>; sort: string; dir?: string;
  defaultDir?: "asc" | "desc"; className?: string; title?: string;
}) {
  const active = sort === col;
  const current = active ? (dir ?? defaultDir) : undefined;
  const next = active ? (current === "asc" ? "desc" : "asc") : defaultDir;
  const s = new URLSearchParams(Object.entries({ ...params, sort: col, dir: next, page: undefined }).filter(([, v]) => v) as [string, string][]);
  return (
    <th className={className} aria-sort={current === "asc" ? "ascending" : current === "desc" ? "descending" : undefined} title={title}>
      <Link href={`${base}?${s}`} scroll={false}>{label}{active && <Icon name={current === "asc" ? "sortUp" : "sortDown"} />}</Link>
    </th>
  );
}

// ---------- results ----------
export function Result({ result }: { result: string }) {
  const cls = result === "0-1" ? "res res-b" : result === "1/2-1/2" ? "res res-d" : "res";
  return <span className={cls} title={result === "1-0" ? "White won" : result === "0-1" ? "Black won" : result === "1/2-1/2" ? "Draw" : "Unfinished"}>{resultLabel[result] ?? result}</span>;
}
/** Result from one player's point of view (win / draw / loss). */
export function Outcome({ score }: { score: number | string | null }) {
  const s = n(score);
  if (s === null) return <span className="res">*</span>;
  return s === 1 ? <span className="res res-win">Win</span> : s === 0 ? <span className="res res-loss">Loss</span> : <span className="res res-d">Draw</span>;
}

/** White wins / draws / Black wins, with percentages printed inside wide-enough segments. */
export function ResultBar({ w, d, b, thin = false }: { w: unknown; d: unknown; b: unknown; thin?: boolean }) {
  const W = Number(w) || 0, D = Number(d) || 0, B = Number(b) || 0, total = W + D + B;
  if (!total) return <span className="muted small">—</span>;
  const p = (x: number) => Math.round((100 * x) / total);
  return (
    <div className={`resbar ${thin ? "resbar-thin" : ""}`} role="img" aria-label={`White won ${W}, drawn ${D}, Black won ${B}`}
      title={`White wins ${W} (${p(W)}%) · Draws ${D} (${p(D)}%) · Black wins ${B} (${p(B)}%)`}>
      {W > 0 && <i className="w" style={{ flex: W }}>{p(W) >= 14 ? `${p(W)}%` : ""}</i>}
      {D > 0 && <i className="d" style={{ flex: D }}>{p(D) >= 14 ? `${p(D)}%` : ""}</i>}
      {B > 0 && <i className="b" style={{ flex: B }}>{p(B) >= 14 ? `${p(B)}%` : ""}</i>}
    </div>
  );
}
export function ResultLegend() {
  return <div className="legend"><span><i className="sw sw-w" /> White won</span><span><i className="sw sw-d" /> Draw</span><span><i className="sw sw-b" /> Black won</span></div>;
}

/** Engine score as a chip coloured by who is better. */
export function EvalChip({ cp, mate }: { cp: unknown; mate?: unknown }) {
  if (n(cp) === null && n(mate) === null) return <span className="muted">—</span>;
  const white = n(mate) !== null ? Number(mate) > 0 : Number(cp) >= 0;
  return <span className={`evalchip ${white ? "evalchip-w" : "evalchip-b"}`}>{pawns(cp, mate)}</span>;
}

// ---------- people ----------
export function TitleChip({ title }: { title?: string | null }) {
  return title ? <span className="chip chip-title" title={TITLES[title] ?? title}>{title}</span> : null;
}
const TITLES: Record<string, string> = { GM: "Grandmaster", IM: "International Master", FM: "FIDE Master", CM: "Candidate Master", WGM: "Woman Grandmaster", WIM: "Woman International Master", WFM: "Woman FIDE Master", WCM: "Woman Candidate Master" };
export function PlayerLink({ id, name, title, photo, rating, size = "sm", meta }: { id: number | string; name: string; title?: string | null; photo?: string | null; rating?: unknown; size?: "" | "sm"; meta?: ReactNode }) {
  return (
    <Link href={`/players/${id}`} className="person" onClick={undefined}>
      {photo !== undefined && <Avatar name={name} photo={photo} size={size} />}
      <span className="truncate"><TitleChip title={title} /> <span className="name">{name}</span>{n(rating) !== null && <span className="meta"> {String(rating)}</span>}{meta}</span>
    </Link>
  );
}

// FIDE federation code → ISO 3166 alpha-2 (for flag images) and country name.
const FEDERATIONS: Record<string, [string, string]> = {
  ARG: ["ar", "Argentina"], ARM: ["am", "Armenia"], AUS: ["au", "Australia"], AUT: ["at", "Austria"], AZE: ["az", "Azerbaijan"],
  BEL: ["be", "Belgium"], BRA: ["br", "Brazil"], BUL: ["bg", "Bulgaria"], CAN: ["ca", "Canada"], CHN: ["cn", "China"],
  CRO: ["hr", "Croatia"], CZE: ["cz", "Czechia"], DEN: ["dk", "Denmark"], EGY: ["eg", "Egypt"], ENG: ["gb-eng", "England"],
  ESP: ["es", "Spain"], FRA: ["fr", "France"], GEO: ["ge", "Georgia"], GER: ["de", "Germany"], GRE: ["gr", "Greece"],
  HUN: ["hu", "Hungary"], IND: ["in", "India"], IRI: ["ir", "Iran"], ISR: ["il", "Israel"], ITA: ["it", "Italy"],
  KAZ: ["kz", "Kazakhstan"], NED: ["nl", "Netherlands"], NOR: ["no", "Norway"], PER: ["pe", "Peru"], PHI: ["ph", "Philippines"],
  POL: ["pl", "Poland"], ROU: ["ro", "Romania"], RUS: ["ru", "Russia"], SCO: ["gb-sct", "Scotland"], SLO: ["si", "Slovenia"],
  SRB: ["rs", "Serbia"], SUI: ["ch", "Switzerland"], SWE: ["se", "Sweden"], TUR: ["tr", "Türkiye"], UKR: ["ua", "Ukraine"],
  USA: ["us", "United States"], UZB: ["uz", "Uzbekistan"], VIE: ["vn", "Vietnam"], MGL: ["mn", "Mongolia"], CUB: ["cu", "Cuba"],
};
export const federationName = (code?: string | null) => (code ? (code === "FID" ? "FIDE (neutral)" : FEDERATIONS[code]?.[1] ?? code) : null);
export function Flag({ code, full = false }: { code?: string | null; full?: boolean }) {
  if (!code) return <span className="muted">—</span>;
  const iso = FEDERATIONS[code]?.[0];
  return (
    <span className="flag" title={federationName(code) ?? code}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {iso ? <img src={`https://flagcdn.com/w40/${iso}.png`} alt="" loading="lazy" /> : <span className="chip" style={{ fontSize: "0.62rem", padding: "0 3px" }}>FIDE</span>}
      <span className={full ? "" : "small"}>{full ? federationName(code) : code}</span>
    </span>
  );
}
export function Eco({ eco }: { eco?: string | null }) { return eco ? <span className="chip chip-eco">{eco}</span> : null; }
/** ECO code + full opening name (wraps; never cut off). */
export function EcoName({ eco, name, href }: { eco?: string | null; name?: string | null; href?: string }) {
  return <span className="eco-name"><Eco eco={eco} />{href ? <Link href={href} style={{ color: "var(--ink)" }}>{name ?? "—"}</Link> : <span>{name ?? "—"}</span>}</span>;
}
