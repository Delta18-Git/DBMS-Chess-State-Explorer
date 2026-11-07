import Link from "next/link";
import { ApiFailure, apiGet, qs } from "@/lib/web/api";
import { RowLink } from "@/components/RowLink";
import { Icon } from "@/components/Icon";
import { Avatar, Card, Eco, Empty, Flag, PageHead, TitleChip, dateRange, EcoName } from "@/components/ui";

export const metadata = { title: "Search · Chess State Explorer" };

const TYPES = [["all", "All"], ["player", "Players"], ["opening", "Openings"], ["tournament", "Tournaments"]] as const;
const TAG: Record<string, string> = { player: "chip-accent", opening: "chip-good", tournament: "chip-warn" };

// Results for the sidebar search (MySQL FULLTEXT, BOOLEAN MODE, prefix matching): one list,
// each row tagged with what it is, filterable by type.
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const type = TYPES.some(([t]) => t === sp.type) ? sp.type! : "all";
  let result: any = null, error: string | null = null;
  if (q) {
    try { result = await apiGet(`/search${qs({ q, limit: 25 })}`); }
    catch (e) { if (e instanceof ApiFailure) error = e.message.replace(/^q: /, ""); else throw e; }
  }
  const rows = result ? [
    ...result.players.map((p: any) => ({ kind: "player", key: `p${p.player_id}`, href: `/players/${p.player_id}`, item: p })),
    ...result.openings.map((o: any) => ({ kind: "opening", key: `o${o.opening_id}`, href: o.position_id ? `/positions/${o.position_id}` : `/openings/${o.opening_id}`, item: o })),
    ...result.tournaments.map((t: any) => ({ kind: "tournament", key: `t${t.tournament_id}`, href: `/tournaments/${t.tournament_id}`, item: t })),
  ] : [];
  const count = (k: string) => (k === "all" ? rows.length : rows.filter(r => r.kind === k).length);
  const shown = type === "all" ? rows : rows.filter(r => r.kind === type);

  return (
    <>
      <PageHead title="Search" lead="Players, openings and tournaments, by name (MySQL full-text search)." />
      <form action="/search" className="card card-body" role="search">
        <div className="lookup">
          <div className="global-search" style={{ flex: 1 }}><Icon name="search" /><input name="q" type="search" defaultValue={q} placeholder="e.g. Gukesh, Najdorf, Wijk aan Zee" autoFocus aria-label="Search" /></div>
          {type !== "all" && <input type="hidden" name="type" value={type} />}
          <button className="btn btn-primary">Search</button>
        </div>
      </form>
      {error && <p className="note note-warn">{error}</p>}
      {result && (
        <Card>
          <div className="filters">
            <div className="seg">
              {TYPES.map(([t, label]) => (
                <Link key={t} href={`/search${qs({ q, type: t === "all" ? undefined : t })}`} aria-current={type === t ? "true" : undefined}>{label} <span className="muted">{count(t)}</span></Link>
              ))}
            </div>
          </div>
          {shown.length ? (
            <table className="t"><thead><tr><th>Type</th><th>Name</th><th>Details</th></tr></thead><tbody>{shown.map(({ kind, key, href, item }) => (
              <RowLink key={key} href={href}>
                <td style={{ width: 110 }}><span className={`chip ${TAG[kind]}`}>{kind === "player" ? "Player" : kind === "opening" ? "Opening" : "Tournament"}</span></td>
                <td>
                  {kind === "player" && <Link href={href} className="person"><Avatar name={item.name} photo={item.photo_url} size="sm" /><span><TitleChip title={item.title} /> <span className="name">{item.name}</span></span></Link>}
                  {kind === "opening" && <EcoName eco={item.eco} name={item.name} href={href} />}
                  {kind === "tournament" && <Link href={href} style={{ color: "var(--ink)", fontWeight: 500 }}>{item.name}</Link>}
                </td>
                <td className="small muted">
                  {kind === "player" && <span className="row" style={{ gap: 12 }}><Flag code={item.federation} />{item.rating ? `FIDE ${item.rating}` : ""}<span>{item.games} games</span></span>}
                  {kind === "opening" && <span className="line">{item.pgn ?? ""}</span>}
                  {kind === "tournament" && <>{dateRange(item.date, item.end_date)}{item.location ? ` · ${item.location}` : ""}</>}
                </td>
              </RowLink>
            ))}</tbody></table>
          ) : <Empty>Nothing matched. Try a surname, an opening name or a city.</Empty>}
        </Card>
      )}
    </>
  );
}
