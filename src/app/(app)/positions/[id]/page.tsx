import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFind, apiGet, currentUser, qs } from "@/lib/web/api";
import { ActionForm, Field } from "@/components/ActionForm";
import { ExplorerBoard } from "@/components/ExplorerBoard";
import { Modal } from "@/components/Modal";
import { MoveGraph } from "@/components/MoveGraph";
import { RowLink } from "@/components/RowLink";
import { Tabs } from "@/components/Tabs";
import { addEvaluation, analyse, deleteEvaluation, updatePositionComment } from "@/app/actions";
import { AdminBar, Eco, EvalChip, Empty, PageHead, Result, ResultBar, ResultLegend, TitleChip, pawns, roundLabel } from "@/components/ui";

export const metadata = { title: "Explorer · Chess State Explorer" };

/** "1.d4 Nf6 2.c4" → ["d4", "Nf6", "c4"] */
const sans = (line?: string | null) => (line ?? "").split(/\s+/).map(t => t.replace(/^\d+\.(\.\.)?/, "")).filter(Boolean);
const numbered = (moves: string[], diff?: Set<number>) => moves.map((m, i) => (
  <span key={i}>{i % 2 === 0 ? `${i / 2 + 1}.` : ""}{diff?.has(i) ? <span className="diff">{m}</span> : m} </span>
));

export default async function PositionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const position = await apiFind(`/positions/${id}`);
  if (!position) notFound();
  const depth = Math.min(5, Math.max(1, Number(sp.depth) || 3));
  const [user, explorer, evals, paths, tree] = await Promise.all([
    currentUser(),
    apiGet(`/analytics/positions/${id}?limit=40`),
    apiGet(`/evaluations?position_id=${id}&limit=10`),
    apiGet(`/graph/positions/${id}/paths?limit=12`).catch(() => null),
    apiGet(`/graph/positions/${id}/tree?depth=${depth}&min_games=${Math.max(1, Number(sp.min_games) || 1)}`).catch(() => null),
  ]);
  const admin = user.role === "admin";
  const node = paths?.nodes?.find((n: any) => Number(n.position_id) === Number(id));
  const line = sp.line ? sp.line.split(" ").filter(Boolean) : sans(node?.line);
  const isStart = Boolean(node?.is_start) || position.comment === "Standard starting position";
  const name = explorer.opening?.name ?? node?.opening ?? (isStart ? "Starting position" : null);
  const toMove = position.fen.split(" ")[1] === "w" ? "White" : "Black";
  const moves = explorer.next_moves;
  const total = moves.reduce((s: number, m: any) => s + Number(m.games), 0);
  const orders = paths?.paths?.filter((p: any) => p.depth > 0) ?? [];
  // Highlight where each move order differs from the first one.
  const base: string[] = orders[0]?.moves ?? [];
  const pathEdges = (paths?.paths ?? []).flatMap((p: any) => p.moves.map((san: string, i: number) => ({
    from_position_id: p.position_ids[i], to_position_id: p.position_ids[i + 1], san, games: p.edge_games[i],
  })));
  const uniqueEdges = [...new Map(pathEdges.map((e: any) => [`${e.from_position_id}-${e.to_position_id}-${e.san}`, e])).values()];
  const lineQs = (san: string) => qs({ line: [...line, san].join(" ") });

  const nextMoves = moves.length ? (
    <>
      <div className="card-body small muted" style={{ paddingBottom: 0 }}>
        {total} game{total === 1 ? "" : "s"} continued from here{position.cp !== null || position.mate !== null ? <> · Stockfish: <b className="ink-2">{pawns(position.cp, position.mate)}</b>, best <b className="ink-2 mono">{position.best_move_san ?? "—"}</b></> : null}
      </div>
      <div className="table-wrap"><table className="t">
        <thead><tr><th>Move</th><th className="num">Games</th><th className="center">White / draw / Black</th><th className="num" title="Stockfish evaluation after the move">Eval</th><th className="num hide-sm" title="Average rating of the players who chose it">Rating</th></tr></thead>
        <tbody>{moves.map((m: any) => (
          <RowLink key={`${m.move_san}-${m.to_position_id}`} href={`/positions/${m.to_position_id}${lineQs(m.move_san)}`}>
            <td><Link href={`/positions/${m.to_position_id}${lineQs(m.move_san)}`} className="san">{m.move_san}</Link>{m.move_san === position.best_move_san && <span className="chip chip-good" style={{ marginLeft: 6 }} title="Stockfish's choice">best</span>}{m.opening_name && <div className="tiny muted" style={{ maxWidth: 220 }}>{m.opening_name}</div>}</td>
            <td className="num nowrap">{m.games} <span className="muted small">· {Math.round((100 * Number(m.games)) / (total || 1))}%</span></td>
            <td style={{ width: 150 }}><ResultBar w={m.white_wins} d={m.draws} b={m.black_wins} /></td>
            <td className="num"><EvalChip cp={m.cp} mate={m.mate} /></td>
            <td className="num hide-sm">{m.avg_elo ?? "—"}</td>
          </RowLink>
        ))}</tbody>
      </table></div>
      <div className="card-foot"><ResultLegend /></div>
    </>
  ) : <Empty>No stored game continued from this position.</Empty>;

  const comesNext = (
    <>
      <div className="filters">
        <span className="small muted" style={{ alignSelf: "center" }}>Every continuation in the stored games</span>
        <div className="seg" style={{ marginLeft: "auto" }}>{[2, 3, 4, 5].map(d => <Link key={d} scroll={false} href={`/positions/${id}${qs({ line: sp.line, depth: d, tab: "graph" })}`} aria-current={depth === d ? "true" : undefined}>{d} plies</Link>)}</div>
      </div>
      {!tree ? <Empty>Graph database offline.</Empty> : tree.edges.length ? <MoveGraph nodes={tree.nodes} edges={tree.edges} rootId={Number(id)} height={520} /> : <Empty>No continuations.</Empty>}
    </>
  );

  const gotHere = !paths ? <Empty>Graph database offline.</Empty> : !paths.in_graph ? <Empty>This board is not part of any stored game.</Empty> : (
    <>
      <div className="card-body small muted" style={{ paddingBottom: 0 }}>{orders.length > 1 ? `Shortest move orders from the starting position. They meet in this board: a transposition (${paths.move_orders} orders).` : "Shortest move order from the starting position."}</div>
      <table className="t compact"><tbody>{orders.slice(0, 6).map((p: any, i: number) => (
        <tr key={i}>
          <td className="line">{numbered(p.moves, i ? new Set(p.moves.map((m: string, j: number) => (m !== base[j] ? j : -1)).filter((j: number) => j >= 0)) : undefined)}</td>
          <td className="small nowrap" style={{ textAlign: "right" }}>{p.played_by.length ? <>{p.played_by.length} game{p.played_by.length === 1 ? "" : "s"}{" "}{p.played_by.slice(0, 3).map((g: number) => <Link key={g} href={`/games/${g}`} style={{ marginLeft: 4 }}>#{g}</Link>)}</> : <span className="muted" title="Stitched from moves of different games">never as a whole</span>}</td>
        </tr>
      ))}</tbody></table>
      {orders.length > 1 && <MoveGraph nodes={paths.nodes} edges={uniqueEdges as any} targetId={Number(id)} height={380} />}
    </>
  );

  const gamesHere = explorer.games.length ? <div className="table-wrap"><table className="t">
    <thead><tr><th>White</th><th className="center">Result</th><th>Black</th><th className="hide-sm">Event</th></tr></thead>
    <tbody>{explorer.games.map((g: any) => (
      <RowLink key={g.game_id} href={`/games/${g.game_id}?ply=${g.ply_no}`}>
        <td><TitleChip title={g.white_title} /> {g.white_name} <span className="muted small">{g.white_elo}</span></td>
        <td className="center"><Result result={g.result} /></td>
        <td><TitleChip title={g.black_title} /> {g.black_name} <span className="muted small">{g.black_elo}</span></td>
        <td className="small muted hide-sm"><div>{g.tournament_name}</div><div className="tiny">{roundLabel(g.round)}</div></td>
      </RowLink>
    ))}</tbody></table></div> : <Empty>No game reached this board (it may only appear in the opening catalogue).</Empty>;

  const evaluations = (
    <>
      {evals.length ? <table className="t">
        <thead><tr><th>Score</th><th>Best move</th><th className="num">Depth</th>{admin && <th />}</tr></thead>
        <tbody>{evals.map((e: any) => (
          <tr key={e.evaluation_id}>
            <td><EvalChip cp={e.cp} mate={e.mate} />{e.evaluation_id === position.evaluation_id && <span className="chip" style={{ marginLeft: 6 }}>used</span>}</td>
            <td className="san">{e.best_move_san ?? "—"}</td>
            <td className="num">{e.depth}</td>
            {admin && <td className="num"><ActionForm inline action={deleteEvaluation.bind(null, e.evaluation_id, position.position_id)} submit="Delete" variant="ghost" small confirm="Delete this evaluation? The audit trigger keeps a snapshot." /></td>}
          </tr>
        ))}</tbody>
      </table> : <Empty>No evaluation stored.</Empty>}
      <div className="card-foot tiny muted">The deepest evaluation is used everywhere (view <code>v_latest_evaluation</code>).{position.comment && !isStart ? <> Comment: {position.comment}</> : null}</div>
      <div className="card-foot tiny muted mono" style={{ wordBreak: "break-all" }}>{position.fen}</div>
    </>
  );

  return (
    <>
      <PageHead crumbs={[["Explorer", "/positions"], ...(name && !isStart ? [[name.split(":")[0], null] as [string, null]] : [])]}
        title={<span className="row" style={{ gap: 10 }}>{explorer.opening && <Eco eco={explorer.opening.eco} />}{name ?? "Position"}</span>}
        lead={<>{toMove} to move · reached in <b>{explorer.usage.games}</b> game{Number(explorer.usage.games) === 1 ? "" : "s"}{orders.length > 1 && <> · <b>{paths.move_orders}</b> different move orders lead here</>}</>}>
        <form className="lookup" action="/positions" style={{ minWidth: 280 }}>
          <input name="moves" placeholder="Jump to moves, e.g. 1.e4 c5 2.Nf3" aria-label="Moves" />
          <button className="btn btn-ghost">Go</button>
        </form>
      </PageHead>

      {admin && (
        <AdminBar hint="Positions themselves are immutable: the FEN is their identity in both databases">
          <ActionForm inline action={analyse.bind(null, { position_id: position.position_id })} submit="Store a Stockfish evaluation" icon="cpu" variant="solid" small>
            <select name="depth" defaultValue="20" aria-label="Depth"><option value="16">Depth 16</option><option value="20">Depth 20</option><option value="24">Depth 24</option></select>
          </ActionForm>
          <Modal label="Add evaluation by hand" icon="plus" title="Add an evaluation" className="btn btn-sm">
            <ActionForm action={addEvaluation.bind(null, position.position_id)} submit="Add evaluation" resetOnSuccess>
              <div className="form-row">
                <Field label="Centipawns (White's view)" hint="Empty for a mate / unscored"><input name="cp" type="number" min={-100000} max={100000} /></Field>
                <Field label="Depth"><input name="depth" type="number" min={1} max={255} required defaultValue={20} /></Field>
              </div>
            </ActionForm>
          </Modal>
          <Modal label="Comment" icon="edit" title="Position comment" className="btn btn-sm">
            <ActionForm action={updatePositionComment.bind(null, position.position_id)} submit="Save comment">
              <Field label="Comment"><textarea name="comment" rows={4} maxLength={10000} defaultValue={position.comment ?? ""} /></Field>
            </ActionForm>
          </Modal>
        </AdminBar>
      )}

      <div className="explorer">
        <ExplorerBoard fen={position.fen} line={line} next={moves.map((m: any) => ({ san: m.move_san, to_position_id: Number(m.to_position_id), games: Number(m.games) }))}
          stored={{ cp: position.cp === null ? null : Number(position.cp), mate: position.mate === null ? null : Number(position.mate), best: position.best_move_san }} />
        <section className="card tabs-card">
          <Tabs initial={sp.tab} tabs={[
            { id: "moves", label: "Next moves", count: moves.length, content: nextMoves },
            { id: "graph", label: "What comes next", content: comesNext },
            ...(isStart ? [] : [{ id: "orders", label: "How games got here", count: orders.length, content: gotHere }]),
            ...(isStart ? [] : [{ id: "games", label: "Games", count: explorer.games.length, content: gamesHere }]),
            { id: "evals", label: "Evaluations", count: evals.length, content: evaluations },
          ]} />
        </section>
      </div>
    </>
  );
}
