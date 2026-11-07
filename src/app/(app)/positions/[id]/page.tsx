import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFind, apiGet, currentUser } from "@/lib/web/api";
import { Board } from "@/components/Board";
import { MoveTree } from "@/components/MoveTree";
import { ActionForm, Field } from "@/components/ActionForm";
import { addEvaluation, deleteEvaluation, updatePositionComment } from "@/app/actions";
import { Db, Empty, PageHead, ResultBar, ResultLegend, n, pawns } from "@/components/ui";

function MoveOrder({ moves }: { moves: string[] }) {
  return (
    <span className="san-list">
      {moves.map((m, i) => <span key={i} className="san">{i % 2 === 0 ? `${i / 2 + 1}.` : ""}{m}</span>)}
    </span>
  );
}

export default async function PositionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ depth?: string; min_games?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const position = await apiFind(`/positions/${id}`);
  if (!position) notFound();
  const depth = Math.min(4, Math.max(1, Number(sp.depth) || 2));
  const minGames = Math.max(1, Number(sp.min_games) || 1);
  const [user, explorer, evals, paths, tree] = await Promise.all([
    currentUser(),
    apiGet(`/analytics/positions/${id}?limit=50`),
    apiGet(`/evaluations?position_id=${id}&limit=10`),
    apiGet(`/graph/positions/${id}/paths?limit=30`).catch(() => null),
    apiGet(`/graph/positions/${id}/tree?depth=${depth}&min_games=${minGames}`).catch(() => null),
  ]);
  const admin = user.role === "admin";
  const sideToMove = position.fen.split(" ")[1] === "w" ? "White" : "Black";

  return (
    <>
      <PageHead title={`Position #${position.position_id}`} sub={<>{sideToMove} to move · seen in <b>{explorer.usage.games}</b> game(s), {explorer.usage.occurrences} time(s)</>}>
        <Link href="/positions" className="btn btn-ghost">Find a position</Link>
      </PageHead>

      <div className="grid" style={{ gridTemplateColumns: "minmax(260px, 400px) 1fr" }}>
        <div className="stack">
          <Board fen={position.fen} />
          <div className="card small stack" style={{ gap: 6 }}>
            <div><span className="muted">Canonical FEN</span><br /><code style={{ wordBreak: "break-all" }}>{position.fen}</code></div>
            <div><span className="muted">Best stored evaluation</span><br /><b>{position.evaluation_id ? pawns(position.cp) : "none"}</b>{position.depth ? <span className="muted"> (depth {position.depth})</span> : null}</div>
            {position.comment && <div><span className="muted">Comment</span><br />{position.comment}</div>}
          </div>
        </div>

        <div className="stack">
          <section className="card">
            <h2>Move orders that reach this board <Db kind="Neo4j" /></h2>
            {!paths ? <Empty>Graph database offline.</Empty>
              : !paths.in_graph ? <Empty>This board is not part of any stored game&apos;s moves.</Empty>
              : (
                <>
                  <p className="muted small" style={{ marginTop: -6 }}>
                    <code>allShortestPaths</code> from the initial board over aggregated <code>MOVE</code> edges.
                    {paths.is_transposition
                      ? <> <b>{paths.move_orders}</b> distinct move orders: this board is a <b>transposition</b>.{paths.unplayed_orders > 0 && <> {paths.unplayed_orders} of them stitch together moves from different games and were never played as a whole.</>}</>
                      : " Only one move order reaches this board."}
                  </p>
                  <div className="table-wrap"><table className="data">
                    <thead><tr><th>Move order</th><th>Played in full by</th></tr></thead>
                    <tbody>{paths.paths.map((p: any, i: number) => (
                      <tr key={i}>
                        <td>{p.depth === 0 ? <span className="muted">initial position</span> : <MoveOrder moves={p.moves} />}</td>
                        <td className="small">{p.depth === 0 ? "—" : p.played_by.length
                          ? p.played_by.slice(0, 5).map((g: number, j: number) => <span key={g}>{j ? ", " : ""}<Link href={`/games/${g}`}>#{g}</Link></span>)
                          : <span className="badge">combined from other games</span>}
                          {p.played_by.length > 5 && <span className="muted"> +{p.played_by.length - 5}</span>}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                </>
              )}
          </section>

          <section className="card">
            <h2>Next moves <Db kind="MySQL" /></h2>
            {explorer.next_moves.length ? (
              <>
                <div className="table-wrap"><table className="data">
                  <thead><tr><th>Move</th><th className="num">Games</th><th>Results</th><th className="num">Occurrences</th></tr></thead>
                  <tbody>{explorer.next_moves.map((m: any) => (
                    <tr key={`${m.move_san}-${m.to_position_id}`}>
                      <td><Link href={`/positions/${m.to_position_id}`} className="san">{m.move_san}</Link></td>
                      <td className="num">{m.games}</td>
                      <td><ResultBar w={n(m.white_wins)!} d={n(m.draws)!} b={n(m.black_wins)!} /></td>
                      <td className="num">{m.occurrences}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
                <ResultLegend />
              </>
            ) : <Empty>No stored game continues from here.</Empty>}
          </section>
        </div>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="page-head" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Opening tree <Db kind="Neo4j" /></h2>
          <form className="row" method="get">
            <label className="field"><span className="field-label">Depth (plies)</span>
              <select name="depth" defaultValue={depth}>{[1, 2, 3, 4].map(d => <option key={d}>{d}</option>)}</select>
            </label>
            <label className="field"><span className="field-label">Min games per move</span>
              <input name="min_games" type="number" min={1} defaultValue={minGames} style={{ width: 90 }} />
            </label>
            <button className="btn btn-ghost" style={{ alignSelf: "flex-end" }}>Update</button>
          </form>
        </div>
        {!tree ? <Empty>Graph database offline.</Empty> : tree.edges.length ? (
          <>
            <p className="muted small" style={{ marginTop: 0 }}>
              Variable-length traversal <code>(root)-[:MOVE*1..{depth}]-&gt;()</code>: {tree.edges.length} edges, {tree.branch_points} branching positions, widest branch {tree.max_branching} moves{tree.truncated ? " (truncated)" : ""}.
            </p>
            <MoveTree rootId={position.position_id} edges={tree.edges} depth={depth} />
          </>
        ) : <Empty>No continuations{minGames > 1 ? ` played in ${minGames}+ games` : ""}.</Empty>}
      </section>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>Evaluation history <Db kind="MySQL" /></h2>
          {evals.length ? (
            <table className="data">
              <thead><tr><th>#</th><th className="num">Score</th><th className="num">Depth</th>{admin && <th />}</tr></thead>
              <tbody>{evals.map((e: any) => (
                <tr key={e.evaluation_id}>
                  <td>{e.evaluation_id}{e.evaluation_id === position.evaluation_id && <span className="badge" style={{ marginLeft: 6 }}>best</span>}</td>
                  <td className="num">{e.cp === null ? "mate / unscored" : pawns(e.cp)}</td>
                  <td className="num">{e.depth}</td>
                  {admin && <td><ActionForm inline action={deleteEvaluation.bind(null, e.evaluation_id, position.position_id)} submit="Delete" variant="ghost" confirm="Delete this evaluation? The audit trigger keeps a snapshot." /></td>}
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty>No evaluations stored for this board.</Empty>}
          <p className="muted small">The best evaluation is chosen by <code>v_latest_evaluation</code> (<code>ROW_NUMBER() OVER (PARTITION BY position_id ORDER BY depth DESC, evaluation_id DESC)</code>).</p>
        </section>
        {admin ? (
          <section className="card stack">
            <h2>Admin</h2>
            <ActionForm action={addEvaluation.bind(null, position.position_id)} submit="Add evaluation" resetOnSuccess>
              <div className="form-row">
                <Field label="Centipawns (White's view)" hint="Leave empty for a mate / unscored result"><input name="cp" type="number" min={-100000} max={100000} /></Field>
                <Field label="Depth *"><input name="depth" type="number" min={1} max={255} required defaultValue={20} /></Field>
              </div>
            </ActionForm>
            <ActionForm action={updatePositionComment.bind(null, position.position_id)} submit="Save comment">
              <Field label="Comment" hint="The FEN itself is immutable: it is the node's identity in both databases."><textarea name="comment" rows={3} maxLength={10000} defaultValue={position.comment ?? ""} /></Field>
            </ActionForm>
          </section>
        ) : (
          <section className="card"><h2>Read-only access</h2><p className="muted">Analysts can explore every board, path and tree. Adding evaluations or comments requires the admin role; the API rejects those writes with 403.</p></section>
        )}
      </div>
    </>
  );
}
