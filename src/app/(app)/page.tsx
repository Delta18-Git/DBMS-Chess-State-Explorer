import Link from "next/link";
import { apiGet } from "@/lib/web/api";
import { Db, Empty, PageHead, ResultBar, ResultLegend, Stat, n, pct, resultLabel } from "@/components/ui";

export const metadata = { title: "Dashboard · Chess State Explorer" };

export default async function Dashboard() {
  const [overview, graph, openings, transpositions, games] = await Promise.all([
    apiGet("/analytics/overview"),
    apiGet("/graph/stats").catch(() => null),
    apiGet("/analytics/openings?min_games=2&limit=8"),
    apiGet("/graph/transpositions?limit=5").catch(() => null),
    apiGet("/games?limit=6"),
  ]);
  const c = overview.counts;
  const coverage = overview.coverage;
  const evalPct = n(c.positions) ? (100 * Number(c.evaluated_positions)) / Number(c.positions) : null;

  return (
    <>
      <PageHead title="Dashboard" sub="One MySQL source of truth for games and evaluations; a Neo4j mirror of positions and moves for path queries." />

      <div className="stats">
        <Stat label="Games" value={c.games} note={`${c.plies} plies`} />
        <Stat label="Unique positions" value={c.positions} note={`${n(c.plies) ? ((1 - Number(c.positions) / Number(c.plies)) * 100).toFixed(1) : 0}% of plies reuse a stored board`} />
        <Stat label="Evaluated positions" value={pct(evalPct, 0)} note={`${c.evaluations} engine evaluations`} />
        <Stat label="Avg centipawn loss" value={coverage.avg_cp_loss ?? "—"} note={`${coverage.blunders ?? 0} blunders · ${pct(coverage.evaluated_ply_pct, 0)} of moves scored`} />
        <Stat label="Players" value={c.players} note={`${c.tournaments} tournaments · ${c.openings} openings`} />
        {graph ? (
          <Stat label="Transpositions (graph)" value={graph.graph.transpositions}
            note={Number(graph.mysql.pending_changes) ? `⚠ ${graph.mysql.pending_changes} change(s) not yet synced` : `${graph.graph.nodes} nodes · ${graph.graph.edges} move edges`} />
        ) : <Stat label="Graph" value="offline" note="Neo4j unreachable; MySQL features still work" />}
      </div>

      <div className="grid grid-2">
        <section className="card">
          <h2>Opening results <Db kind="MySQL" /></h2>
          {openings.length ? (
            <>
              <div className="table-wrap"><table className="data">
                <thead><tr><th>Opening</th><th className="num">Games</th><th>Results</th><th className="num">White score</th></tr></thead>
                <tbody>{openings.map((o: any) => (
                  <tr key={o.opening_id}>
                    <td><span className="mono">{o.eco}</span> <Link href={`/games?opening_id=${o.opening_id}`}>{o.name}</Link></td>
                    <td className="num">{o.games}</td>
                    <td><ResultBar w={n(o.white_wins)!} d={n(o.draws)!} b={n(o.black_wins)!} /></td>
                    <td className="num">{pct(o.white_score_pct, 0)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <ResultLegend />
            </>
          ) : <Empty>No opening has 2+ games yet.</Empty>}
          <p className="small"><Link href="/openings">All openings →</Link></p>
        </section>

        <section className="card">
          <h2>Top transpositions <Db kind="Neo4j" /></h2>
          <p className="muted small" style={{ marginTop: -6 }}>Boards reached from two or more different previous boards: move orders that merge.</p>
          {transpositions?.length ? (
            <table className="data">
              <thead><tr><th>Position</th><th className="num">Routes in</th><th className="num">Games</th></tr></thead>
              <tbody>{transpositions.map((t: any) => (
                <tr key={t.position_id}>
                  <td><Link href={`/positions/${t.position_id}`}>#{t.position_id}</Link> <span className="muted small">via {t.incoming.map((i: any) => i.san).join(" / ")}</span></td>
                  <td className="num">{t.routes}</td>
                  <td className="num">{t.games}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty>{transpositions ? "No transpositions yet. Import games and sync the graph." : "Graph database offline."}</Empty>}
          <p className="small"><Link href="/transpositions">All transpositions →</Link></p>
        </section>

        <section className="card">
          <h2>Most accurate players <Db kind="MySQL" /></h2>
          <p className="muted small" style={{ marginTop: -6 }}>Average centipawn loss per move (lower is better), players with 20+ evaluated moves.</p>
          {overview.accuracy.length ? (
            <table className="data">
              <thead><tr><th>Player</th><th className="num">Games</th><th className="num">Avg loss</th><th className="num">Blunders</th></tr></thead>
              <tbody>{overview.accuracy.map((p: any) => (
                <tr key={p.player_id}>
                  <td><Link href={`/players/${p.player_id}`}>{p.title ? `${p.title} ` : ""}{p.name}</Link> <span className="muted small">{p.rating ?? ""}</span></td>
                  <td className="num">{p.games}</td>
                  <td className="num">{p.avg_cp_loss}</td>
                  <td className="num">{p.blunders}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty>Not enough evaluated moves yet.</Empty>}
        </section>

        <section className="card">
          <h2>Recent games <Db kind="MySQL" /></h2>
          {games.length ? (
            <table className="data">
              <thead><tr><th>White</th><th>Black</th><th>Result</th><th>Opening</th></tr></thead>
              <tbody>{games.map((g: any) => (
                <tr key={g.game_id}>
                  <td>{g.white_name}</td><td>{g.black_name}</td>
                  <td><Link href={`/games/${g.game_id}`}>{resultLabel[g.result]}</Link></td>
                  <td className="small">{g.eco ?? ""} {g.opening_name ?? ""}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty>No games yet. <Link href="/games/import">Import one</Link>.</Empty>}
          <p className="small"><Link href="/games">All games →</Link></p>
        </section>
      </div>
    </>
  );
}
