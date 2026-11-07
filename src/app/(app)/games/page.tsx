import Link from "next/link";
import { apiAll, apiGet, currentUser, qs } from "@/lib/web/api";
import { Db, Empty, PageHead, Pager, resultLabel } from "@/components/ui";

export const metadata = { title: "Games · Chess State Explorer" };
const LIMIT = 25;

export default async function GamesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const offset = Math.max(0, Number(sp.offset) || 0);
  const filters = { player_id: sp.player_id, opening_id: sp.opening_id };
  const [user, games, players, openings] = await Promise.all([
    currentUser(),
    apiGet(`/games${qs({ ...filters, limit: LIMIT, offset })}`),
    apiAll("/players"),
    apiAll("/openings"),
  ]);
  players.sort((a: any, b: any) => a.name.localeCompare(b.name));
  openings.sort((a: any, b: any) => a.eco.localeCompare(b.eco) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHead title="Games" sub={<>Stored games with players, tournament and opening (JOINs). <Db kind="MySQL" /></>}>
        {user.role === "admin" && <Link href="/games/import" className="btn btn-primary">Import PGN</Link>}
      </PageHead>
      {sp.deleted && <p className="callout">Game deleted. Its plies were removed in the same transaction; shared positions were kept, and the graph was updated through the outbox.</p>}
      <form className="card row" style={{ marginBottom: 16 }} method="get">
        <label className="field">
          <span className="field-label">Player (either colour)</span>
          <select name="player_id" defaultValue={sp.player_id ?? ""}>
            <option value="">All players</option>
            {players.map((p: any) => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Opening</span>
          <select name="opening_id" defaultValue={sp.opening_id ?? ""}>
            <option value="">All openings</option>
            {openings.map((o: any) => <option key={o.opening_id} value={o.opening_id}>{o.eco} {o.name}</option>)}
          </select>
        </label>
        <div className="row" style={{ alignSelf: "flex-end" }}>
          <button className="btn btn-primary">Filter</button>
          <Link href="/games" className="btn btn-ghost">Reset</Link>
        </div>
      </form>
      <section className="card">
        {games.length ? (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>#</th><th>Date</th><th>White</th><th>Black</th><th>Result</th><th>Opening</th><th>Tournament</th></tr></thead>
            <tbody>{games.map((g: any) => (
              <tr key={g.game_id}>
                <td><Link href={`/games/${g.game_id}`}>{g.game_id}</Link></td>
                <td className="small">{g.date ?? "—"}</td>
                <td><Link href={`/players/${g.white_player_id}`}>{g.white_name}</Link></td>
                <td><Link href={`/players/${g.black_player_id}`}>{g.black_name}</Link></td>
                <td><Link href={`/games/${g.game_id}`}><b>{resultLabel[g.result]}</b></Link></td>
                <td className="small">{g.eco && <span className="mono">{g.eco}</span>} {g.opening_name ?? "—"}</td>
                <td className="small">{g.tournament_name ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>No games match these filters.</Empty>}
        <Pager base="/games" params={filters} offset={offset} limit={LIMIT} count={games.length} />
      </section>
    </>
  );
}
