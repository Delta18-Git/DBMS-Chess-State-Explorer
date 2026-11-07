import Link from "next/link";
import { ApiFailure, apiGet, qs } from "@/lib/web/api";
import { Db, Empty, PageHead } from "@/components/ui";

export const metadata = { title: "Search · Chess State Explorer" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q?.trim() ?? "";
  let result: any = null, error: string | null = null;
  if (q) {
    try { result = await apiGet(`/search${qs({ q })}`); }
    catch (e) { if (e instanceof ApiFailure) error = e.message; else throw e; }
  }
  const total = result ? result.players.length + result.openings.length + result.tournaments.length : 0;
  return (
    <>
      <PageHead title="Search" sub={<>Full-text search over players, openings and tournaments (<code>MATCH … AGAINST … IN BOOLEAN MODE</code>). <Db kind="MySQL" /></>} />
      <form className="card searchbar" method="get" style={{ marginBottom: 16 }}>
        <input name="q" defaultValue={q} placeholder="e.g. sicilian, catalan open, marshall, cannon" style={{ flex: 1 }} autoFocus />
        <button className="btn btn-primary">Search</button>
      </form>
      {error && <p className="msg msg-error">{error}</p>}
      {result && (
        <>
          <p className="muted small">Boolean query sent to MySQL: <code>{result.query}</code> · {total} result(s)</p>
          {total === 0 ? <Empty>Nothing matched. Words shorter than 3 letters are not indexed by InnoDB.</Empty> : (
            <div className="grid grid-3">
              <section className="card"><h2>Players</h2>
                {result.players.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{result.players.map((p: any) => <li key={p.player_id}><Link href={`/players/${p.player_id}`}>{p.name}</Link> <span className="muted small">{p.games} games</span></li>)}</ul> : <p className="muted">None</p>}
              </section>
              <section className="card"><h2>Openings</h2>
                {result.openings.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{result.openings.map((o: any) => <li key={o.opening_id}><span className="mono">{o.eco}</span> <Link href={`/games?opening_id=${o.opening_id}`}>{o.name}</Link></li>)}</ul> : <p className="muted">None</p>}
              </section>
              <section className="card"><h2>Tournaments</h2>
                {result.tournaments.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{result.tournaments.map((t: any) => <li key={t.tournament_id}>{t.name} <span className="muted small">{t.date ?? ""}</span></li>)}</ul> : <p className="muted">None</p>}
              </section>
            </div>
          )}
        </>
      )}
    </>
  );
}
