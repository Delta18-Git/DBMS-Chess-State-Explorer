import Link from "next/link";
import { notFound } from "next/navigation";
import { apiAll, apiFind, apiGet, currentUser } from "@/lib/web/api";
import { GameViewer } from "@/components/GameViewer";
import { ActionForm, Field } from "@/components/ActionForm";
import { deleteGame, updateGame } from "@/app/actions";
import { Db, PageHead, pawns, resultLabel } from "@/components/ui";

export default async function GamePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ imported?: string }> }) {
  const { id } = await params;
  const { imported } = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const game = await apiFind(`/games/${id}`);
  if (!game) notFound();
  const [user, novelty, start] = await Promise.all([
    currentUser(),
    apiGet(`/graph/games/${id}/novelty`).catch(() => null),
    apiGet(`/positions?fen=${encodeURIComponent("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")}`).catch(() => []),
  ]);
  const admin = user.role === "admin";
  const [openings, tournaments] = admin ? await Promise.all([apiAll("/openings"), apiAll("/tournaments")]) : [[], []];
  const plies = game.plies;
  const scored = plies.filter((p: any) => p.cp_loss !== null);
  const side = (s: "w" | "b") => {
    const mine = scored.filter((p: any) => p.side === s);
    const avg = mine.length ? mine.reduce((a: number, p: any) => a + Number(p.cp_loss), 0) / mine.length : null;
    return { avg, blunders: mine.filter((p: any) => Number(p.cp_loss) >= 200).length, moves: mine.length };
  };
  const w = side("w"), b = side("b");
  const nov = novelty?.novelty;

  return (
    <>
      <PageHead
        title={`${game.white_name} – ${game.black_name}`}
        sub={<><b>{resultLabel[game.result]}</b> · {game.date ?? "undated"} · {game.eco ? <><span className="mono">{game.eco}</span> {game.opening_name}</> : "unclassified opening"}{game.tournament_name ? ` · ${game.tournament_name}` : ""}</>}
      >
        <Link href="/games" className="btn btn-ghost">← Games</Link>
      </PageHead>
      {imported && <p className="callout">Imported in one transaction: {plies.length} plies. The graph outbox was drained, so this game&apos;s moves are already in Neo4j.</p>}

      <GameViewer plies={plies} noveltyPly={nov?.ply_no ?? null} startPositionId={start[0]?.position_id ?? null} />

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>Move quality <Db kind="MySQL" /></h2>
          <table className="data">
            <thead><tr><th /><th className="num">Avg loss</th><th className="num">Blunders</th><th className="num">Scored</th></tr></thead>
            <tbody>
              <tr><td>White</td><td className="num">{w.avg === null ? "—" : w.avg.toFixed(1)}</td><td className="num">{w.blunders}</td><td className="num">{w.moves}</td></tr>
              <tr><td>Black</td><td className="num">{b.avg === null ? "—" : b.avg.toFixed(1)}</td><td className="num">{b.blunders}</td><td className="num">{b.moves}</td></tr>
            </tbody>
          </table>
          <p className="muted small">Computed in SQL by <code>v_ply_analysis</code>: best evaluation before vs after each move, sign-flipped for Black. Moves without both scores are excluded, not counted as zero.</p>
        </section>

        <section className="card">
          <h2>Novelty <Db kind="Neo4j" /></h2>
          {!novelty ? <p className="muted">Graph database offline.</p>
            : !novelty.synced ? <p className="callout callout-warn">This game is still in the graph outbox. Sync the graph from <Link href="/admin">Admin</Link>.</p>
            : nov ? (
              <div className="stack" style={{ gap: 8 }}>
                <p style={{ margin: 0 }}>
                  Left known theory at move <b>{Math.ceil(nov.ply_no / 2)}{nov.ply_no % 2 ? "." : "…"} {nov.san}</b> after {nov.book_plies} shared plies.
                </p>
                {nov.alternatives.length > 0 && <p className="small" style={{ margin: 0 }}>Other games played: {nov.alternatives.map((a: any) => <span key={a.san} className="san">{a.san} <span className="san-num">×{a.games}</span></span>)}</p>}
                {nov.reference_games.length > 0 && <p className="small muted" style={{ margin: 0 }}>Followed the exact moves of {nov.reference_games.slice(0, 6).map((g: number, i: number) => <span key={g}>{i ? ", " : ""}<Link href={`/games/${g}`}>#{g}</Link></span>)} until then.</p>}
                <Link href={`/positions/${nov.from_position_id}`} className="small">Explore the branching position →</Link>
              </div>
            ) : <p className="muted">Every move of this game also occurs in another stored game (no novelty).</p>}
        </section>

        <section className="card">
          <h2>Biggest mistakes</h2>
          {scored.filter((p: any) => Number(p.cp_loss) >= 100).length ? (
            <table className="data">
              <thead><tr><th>Move</th><th className="num">Before</th><th className="num">After</th><th className="num">Loss</th></tr></thead>
              <tbody>{[...scored].sort((x: any, y: any) => Number(y.cp_loss) - Number(x.cp_loss)).slice(0, 5).filter((p: any) => Number(p.cp_loss) >= 100).map((p: any) => (
                <tr key={p.ply_no}>
                  <td>{Math.ceil(p.ply_no / 2)}{p.side === "w" ? "." : "…"} {p.move_san}</td>
                  <td className="num">{pawns(p.before_cp)}</td><td className="num">{pawns(p.after_cp)}</td>
                  <td className="num"><b>{(Number(p.cp_loss) / 100).toFixed(1)}</b></td>
                </tr>
              ))}</tbody>
            </table>
          ) : <p className="muted">No move lost a pawn or more (among scored moves).</p>}
        </section>
      </div>

      <details className="card" style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer" }}><b>Stored PGN</b> <span className="muted small">(normalised by the server)</span></summary>
        <pre className="mono small" style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{game.pgn}</pre>
      </details>

      {admin && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Admin</h2>
          <div className="grid grid-2">
            <ActionForm action={updateGame.bind(null, game.game_id)} submit="Update metadata">
              <p className="muted small" style={{ margin: 0 }}>Moves, players and result are immutable (they must agree with the PGN). Only these fields can change; the row is locked <code>FOR UPDATE</code> while merging.</p>
              <div className="form-row">
                <Field label="Opening">
                  <select name="opening_id" defaultValue={game.opening_id ?? ""}>
                    <option value="">Unclassified</option>
                    {openings.map((o: any) => <option key={o.opening_id} value={o.opening_id}>{o.eco} {o.name}</option>)}
                  </select>
                </Field>
                <Field label="Tournament">
                  <select name="tournament_id" defaultValue={game.tournament_id ?? ""}>
                    <option value="">None</option>
                    {tournaments.map((t: any) => <option key={t.tournament_id} value={t.tournament_id}>{t.name}</option>)}
                  </select>
                </Field>
                <Field label="Date"><input type="date" name="date" defaultValue={game.date ?? ""} /></Field>
              </div>
            </ActionForm>
            <ActionForm action={deleteGame.bind(null, game.game_id)} submit="Delete game" variant="danger" confirm="Delete this game and its plies? Shared positions stay.">
              <p className="muted small" style={{ margin: 0 }}>Deletes plies then the game in one transaction. Positions and evaluations are shared by other games, so they are kept. The delete trigger queues a graph update.</p>
            </ActionForm>
          </div>
        </section>
      )}
    </>
  );
}
