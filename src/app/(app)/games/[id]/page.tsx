import Link from "next/link";
import { notFound } from "next/navigation";
import { DEFAULT_POSITION } from "chess.js";
import { apiAll, apiFind, apiGet, currentUser } from "@/lib/web/api";
import { GameViewer, type Side } from "@/components/GameViewer";
import { Tabs } from "@/components/Tabs";
import { ActionForm, Field } from "@/components/ActionForm";
import { Modal } from "@/components/Modal";
import { Icon } from "@/components/Icon";
import { analyse, deleteGame, updateGame } from "@/app/actions";
import { AdminBar, Card, Eco, PageHead, displayName, fmtDate, moveNo, pawns, resultLabel, roundLabel } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const game = /^\d+$/.test((await params).id) ? await apiFind(`/games/${(await params).id}`) : null;
  return { title: game ? `${displayName(game.white_name)} – ${displayName(game.black_name)} · Chess State Explorer` : "Game" };
}

export default async function GamePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ imported?: string; ply?: string; tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const game = await apiFind(`/games/${id}`);
  if (!game) notFound();
  const [user, novelty, start] = await Promise.all([
    currentUser(),
    apiGet(`/graph/games/${id}/novelty`).catch(() => null),
    apiGet(`/positions?fen=${encodeURIComponent(DEFAULT_POSITION)}`).catch(() => []),
  ]);
  const admin = user.role === "admin";
  const [openings, tournaments] = admin ? await Promise.all([apiAll("/analytics/openings?sort=eco"), apiAll("/tournaments")]) : [[], []];
  const plies = game.plies;
  const scored = plies.filter((p: any) => p.cp_loss !== null);
  const side = (s: "w" | "b") => {
    const mine = scored.filter((p: any) => p.side === s);
    const avg = mine.length ? mine.reduce((a: number, p: any) => a + Number(p.cp_loss), 0) / mine.length : null;
    return { avg, blunders: mine.filter((p: any) => Number(p.cp_loss) >= 200).length, mistakes: mine.filter((p: any) => Number(p.cp_loss) >= 100 && Number(p.cp_loss) < 200).length, moves: mine.length };
  };
  const w = side("w"), b = side("b");
  const nov = novelty?.novelty;
  const [ws, bs] = game.result === "1-0" ? ["1", "0"] : game.result === "0-1" ? ["0", "1"] : game.result === "1/2-1/2" ? ["½", "½"] : ["", ""];
  const white: Side = { id: game.white_player_id, name: game.white_name, title: game.white_title, federation: game.white_federation, photo: game.white_photo, elo: game.white_elo, score: ws };
  const black: Side = { id: game.black_player_id, name: game.black_name, title: game.black_title, federation: game.black_federation, photo: game.black_photo, elo: game.black_elo, score: bs };
  const worst = [...scored].sort((x: any, y: any) => Number(y.cp_loss) - Number(x.cp_loss)).filter((p: any) => Number(p.cp_loss) >= 100).slice(0, 6);
  const initialPly = sp.ply && /^\d+$/.test(sp.ply) ? Number(sp.ply) : undefined;

  return (
    <>
      <PageHead
        crumbs={[["Games", "/games"], ...(game.tournament_name ? [[game.tournament_name, `/tournaments/${game.tournament_id}`] as [string, string]] : [])]}
        title={<>{displayName(game.white_name)} <span className="muted" style={{ fontWeight: 400 }}>vs</span> {displayName(game.black_name)} <span className="muted" style={{ fontWeight: 400 }}>{resultLabel[game.result]}</span></>}
        lead={<span className="row" style={{ gap: 8 }}>
          {game.opening_name && <><Eco eco={game.eco} /><span>{game.opening_name}</span><span className="muted">·</span></>}
          <span>{roundLabel(game.round) ?? "Round —"}</span><span className="muted">·</span><span>{fmtDate(game.date)}</span>
        </span>}
      >
        {game.source_url && <a href={game.source_url} target="_blank" rel="noreferrer" className="btn btn-ghost"><Icon name="external" />View on Lichess</a>}
      </PageHead>

      {admin && (
        <AdminBar hint="Moves, players and result are fixed by the PGN">
          <ActionForm inline action={analyse.bind(null, { game_id: game.game_id })} submit="Analyse with Stockfish" icon="cpu" variant="solid" small>
            <select name="depth" defaultValue="16" aria-label="Search depth"><option value="12">Depth 12</option><option value="16">Depth 16</option><option value="20">Depth 20</option></select>
          </ActionForm>
          <Modal label="Edit details" icon="edit" title="Edit game details" className="btn btn-sm">
            <ActionForm action={updateGame.bind(null, game.game_id)} submit="Save">
              <Field label="Opening">
                <select name="opening_id" defaultValue={game.opening_id ?? ""}><option value="">Unclassified</option>{openings.map((o: any) => <option key={o.opening_id} value={o.opening_id}>{o.eco} {o.name}</option>)}</select>
              </Field>
              <Field label="Tournament">
                <select name="tournament_id" defaultValue={game.tournament_id ?? ""}><option value="">None</option>{tournaments.map((t: any) => <option key={t.tournament_id} value={t.tournament_id}>{t.name}</option>)}</select>
              </Field>
              <Field label="Date"><input type="date" name="date" defaultValue={game.date ?? ""} /></Field>
            </ActionForm>
          </Modal>
          <ActionForm inline action={deleteGame.bind(null, game.game_id)} submit="Delete" icon="trash" variant="danger" small confirm="Delete this game and its moves? Positions shared with other games stay." />
        </AdminBar>
      )}
      {sp.imported && <p className="note note-ok" style={{ marginBottom: 16 }}>Imported: {plies.length} moves stored in one transaction and mirrored into the graph.{admin ? " Use “Analyse with Stockfish” to score them." : ""}</p>}

      <GameViewer plies={plies} noveltyPly={nov?.ply_no ?? null} startPositionId={start[0]?.position_id ?? null} white={white} black={black} initialPly={initialPly ?? plies.length} />

      <section className="card">
        <Tabs initial={sp.tab} tabs={[
          { id: "accuracy", label: "Accuracy", content: <>
          <table className="t">
            <thead><tr><th /><th className="num">Avg loss</th><th className="num">Mistakes</th><th className="num">Blunders</th></tr></thead>
            <tbody>
              <tr><td><span className="row" style={{ gap: 6 }}><span className="side-dot" />White</span></td><td className="num">{w.avg === null ? "—" : w.avg.toFixed(0)}</td><td className="num">{w.mistakes}</td><td className="num">{w.blunders}</td></tr>
              <tr><td><span className="row" style={{ gap: 6 }}><span className="side-dot b" />Black</span></td><td className="num">{b.avg === null ? "—" : b.avg.toFixed(0)}</td><td className="num">{b.mistakes}</td><td className="num">{b.blunders}</td></tr>
            </tbody>
          </table>
          <div className="card-foot muted tiny">{scored.length} of {plies.length} moves scored. Mistake ≥ 1 pawn lost, blunder ≥ 2.</div>
          </> },
          { id: "novelty", label: "Out of book", content: <>
            <div className="card-body small muted" style={{ paddingBottom: 0 }}>Where this game left every other stored game (Neo4j).</div>
          <div className="card-body stack-sm">
            {!novelty ? <p className="muted">Graph database offline.</p>
              : !novelty.synced ? <p className="note note-warn">This game is still waiting to be synced into the graph.</p>
              : nov ? (
                <>
                  <p><b className="mono">{moveNo(nov.ply_no)} {nov.san}</b> was new after {Math.floor(nov.book_plies / 2)} shared moves.</p>
                  {nov.alternatives.length > 0 && <p className="small">Others played: {nov.alternatives.slice(0, 5).map((a: any) => <span key={a.san} className="chip" style={{ marginRight: 4 }}><span className="mono">{a.san}</span> ×{a.games}</span>)}</p>}
                  {nov.reference_games.length > 0 && <p className="small muted">Same moves until then as {nov.reference_games.slice(0, 4).map((g: number, i: number) => <span key={g}>{i ? ", " : ""}<Link href={`/games/${g}`}>game {g}</Link></span>)}{nov.reference_games.length > 4 ? ` and ${nov.reference_games.length - 4} more` : ""}.</p>}
                  <Link href={`/positions/${nov.from_position_id}`} className="small">Explore the position before it →</Link>
                </>
              ) : <p className="muted">Every move of this game was also played in another stored game.</p>}
          </div>
          </> },
          { id: "mistakes", label: "Biggest mistakes", count: worst.length, content: <>
          {worst.length ? (
            <table className="t compact"><tbody>{worst.map((p: any) => (
              <tr key={p.ply_no}>
                <td><Link href={`/games/${game.game_id}?ply=${p.ply_no}`} className="san">{moveNo(p.ply_no)} {p.move_san}</Link></td>
                <td className="small muted">{p.best_move_san && p.best_move_san !== p.move_san ? <>best <span className="mono">{p.best_move_san}</span></> : ""}</td>
                <td className="num small"><span className={Number(p.cp_loss) >= 200 ? "q-blunder" : "q-mistake"}>−{(Number(p.cp_loss) / 100).toFixed(1)}</span></td>
                <td className="num small muted hide-sm">{pawns(p.before_cp)} → {pawns(p.after_cp)}</td>
              </tr>
            ))}</tbody></table>
          ) : <div className="empty">No move lost a pawn or more.</div>}
          </> },
          { id: "pgn", label: "PGN", content: <pre className="mono small card-body" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{game.pgn}</pre> },
        ]} />
      </section>
    </>
  );
}
