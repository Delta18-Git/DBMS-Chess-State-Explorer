import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFind, apiGet, currentUser } from "@/lib/web/api";
import { ActionForm } from "@/components/ActionForm";
import { deletePlayer, updatePlayer } from "@/app/actions";
import { Db, Empty, PageHead, Stat, pawns, pct, resultLabel } from "@/components/ui";
import { PlayerFields } from "@/components/PlayerFields";

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const player = await apiFind(`/players/${id}`);
  if (!player) notFound();
  const [user, analytics, games, repertoires] = await Promise.all([
    currentUser(), apiGet(`/analytics/players/${id}?limit=10`), apiGet(`/games?player_id=${id}&limit=50`), apiGet(`/repertoires?player_id=${id}`),
  ]);
  const s = analytics.summary;
  const score = Number(s.games) - Number(s.unfinished) > 0 ? (100 * (Number(s.wins) + Number(s.draws) / 2)) / (Number(s.games) - Number(s.unfinished)) : null;
  return (
    <>
      <PageHead title={`${player.title ? player.title + " " : ""}${player.name}`} sub={<>{player.rating ? `Rating ${player.rating}` : "Unrated"}{player.federation ? ` · ${player.federation}` : ""}{player.birth_year ? ` · born ${player.birth_year}` : ""}</>}>
        <Link href="/players" className="btn btn-ghost">← Players</Link>
      </PageHead>
      <p className="muted small">Summary from the stored procedure <code>CALL sp_player_summary({player.player_id})</code> <Db kind="MySQL" /></p>
      <div className="stats">
        <Stat label="Games" value={s.games} note={`${s.wins} W · ${s.draws} D · ${s.losses} L`} />
        <Stat label="Score" value={pct(score, 0)} note="draw = ½ point" />
        <Stat label="Avg centipawn loss" value={s.average_cp_loss ?? "—"} note={`${s.evaluated_plies} evaluated moves`} />
        <Stat label="Blunders" value={s.blunders} note={`${pct(s.blunder_rate_pct, 1)} of evaluated moves`} />
      </div>
      <div className="grid grid-2">
        <section className="card">
          <h2>Games</h2>
          {games.length ? (
            <table className="data">
              <thead><tr><th>Colour</th><th>Opponent</th><th>Result</th><th>Opening</th></tr></thead>
              <tbody>{games.map((g: any) => {
                const white = String(g.white_player_id) === String(player.player_id);
                return (
                  <tr key={g.game_id}>
                    <td>{white ? "White" : "Black"}</td>
                    <td><Link href={`/players/${white ? g.black_player_id : g.white_player_id}`}>{white ? g.black_name : g.white_name}</Link></td>
                    <td><Link href={`/games/${g.game_id}`}>{resultLabel[g.result]}</Link></td>
                    <td className="small">{g.eco ?? ""} {g.opening_name ?? ""}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          ) : <Empty>No games.</Empty>}
        </section>
        <div className="stack">
          <section className="card">
            <h2>Worst moves</h2>
            {analytics.blunders.length ? (
              <table className="data">
                <thead><tr><th>Game</th><th>Move</th><th className="num">Before</th><th className="num">After</th><th className="num">Loss</th></tr></thead>
                <tbody>{analytics.blunders.map((b: any) => (
                  <tr key={`${b.game_id}-${b.ply_no}`}>
                    <td><Link href={`/games/${b.game_id}`}>#{b.game_id}</Link></td>
                    <td>{Math.ceil(b.ply_no / 2)}{b.side === "w" ? "." : "…"} {b.move_san}</td>
                    <td className="num">{pawns(b.before_cp)}</td><td className="num">{pawns(b.after_cp)}</td>
                    <td className="num"><b>{(Number(b.cp_loss) / 100).toFixed(1)}</b></td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <Empty>No blunders (≥2 pawns) among evaluated moves.</Empty>}
          </section>
          <section className="card">
            <h2>Repertoires</h2>
            {repertoires.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{repertoires.map((r: any) => <li key={r.repertoire_id}><Link href={`/repertoires/${r.repertoire_id}`}>{r.name}</Link> <span className="muted small">{r.line_count} moves</span></li>)}</ul> : <Empty>None.</Empty>}
          </section>
        </div>
      </div>
      {user.role === "admin" && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Admin</h2>
          <ActionForm action={updatePlayer.bind(null, player.player_id)} submit="Save changes"><PlayerFields p={player} /></ActionForm>
          <div style={{ marginTop: 12 }}>
            <ActionForm action={deletePlayer.bind(null, player.player_id)} submit="Delete player" variant="danger" confirm="Delete this player?">
              <p className="muted small" style={{ margin: 0 }}>Foreign keys are <code>ON DELETE RESTRICT</code>: a player with games or repertoires cannot be deleted (409).</p>
            </ActionForm>
          </div>
        </section>
      )}
    </>
  );
}
