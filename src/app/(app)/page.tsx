import Link from "next/link";
import { apiGet } from "@/lib/web/api";
import { Icon } from "@/components/Icon";
import { RowLink } from "@/components/RowLink";
import { Avatar, Card, Eco, Empty, Flag, ResultBar, Stat, Stats, TitleChip, dateRange, n, pct, EcoName } from "@/components/ui";

export const metadata = { title: "Home · Chess State Explorer" };

export default async function Home() {
  const [overview, graph, openings, transpositions, tournaments] = await Promise.all([
    apiGet("/analytics/overview"),
    apiGet("/graph/stats").catch(() => null),
    apiGet("/analytics/openings?min_games=4&limit=6"),
    apiGet("/graph/transpositions?limit=4&sort=games&min_games=3").catch(() => null),
    apiGet("/tournaments?limit=4"),
  ]);
  const c = overview.counts;
  const evaluated = n(c.positions) ? (100 * Number(c.evaluated_positions)) / Number(c.positions) : null;

  return (
    <>
      <section className="card hero">
        <div>
          <h1>Scout openings and players from real tournament games</h1>
          <p>
            An engine scores one position; this database works across a whole collection of games. See every move order
            that reaches a position, where each player leaves known theory, how accurately they play, and what they choose in
            the openings you are preparing.
          </p>
          <div className="hero-actions">
            <Link href="/positions" className="btn btn-primary"><Icon name="explore" />Open the explorer</Link>
            <Link href="/transpositions" className="btn btn-ghost"><Icon name="merge" />Browse transpositions</Link>
            <Link href="/players" className="btn btn-ghost"><Icon name="players" />Scout a player</Link>
          </div>
        </div>
      </section>

      <Stats>
        <Stat label="Games" value={Number(c.games).toLocaleString("en")} note={`${c.tournaments} tournaments`} />
        <Stat label="Players" value={c.players} note="FIDE-rated, from Lichess" />
        <Stat label="Distinct positions" value={Number(c.positions).toLocaleString("en")} note={`${pct(evaluated)} scored by Stockfish`} />
        <Stat label="Transpositions" value={graph ? Number(graph.graph.transpositions).toLocaleString("en") : "—"} note={graph ? "boards reached by 2+ move orders" : "graph offline"} />
        <Stat label="Avg centipawn loss" value={overview.coverage.avg_cp_loss ?? "—"} note={`${overview.coverage.blunders ?? 0} blunders found`} />
      </Stats>

      <div className="grid grid-2">
        <Card title="Recent tournaments" db="MySQL" foot={<Link href="/tournaments">All tournaments →</Link>}>
          <table className="t"><tbody>{tournaments.map((t: any) => (
            <RowLink key={t.tournament_id} href={`/tournaments/${t.tournament_id}`}>
              <td><Link href={`/tournaments/${t.tournament_id}`} style={{ color: "var(--ink)", fontWeight: 500 }}>{t.name}</Link><div className="tiny muted">{t.location ?? ""}</div></td>
              <td className="small muted nowrap hide-sm">{dateRange(t.date, t.end_date)}</td>
              <td className="num small">{t.games} games</td>
            </RowLink>
          ))}</tbody></table>
        </Card>

        <Card title="Most accurate players" sub="Lowest average centipawn loss per move (20+ scored moves)" db="MySQL" foot={<Link href="/players?sort=score">All players →</Link>}>
          {overview.accuracy.length ? (
            <table className="t"><tbody>{overview.accuracy.slice(0, 5).map((p: any) => (
              <RowLink key={p.player_id} href={`/players/${p.player_id}`}>
                <td><Link href={`/players/${p.player_id}`} className="person"><Avatar name={p.name} photo={p.photo_url} size="sm" /><span className="truncate"><TitleChip title={p.title} /> <span className="name">{p.name}</span></span></Link></td>
                <td className="hide-sm"><Flag code={p.federation} /></td>
                <td className="num small">{p.avg_cp_loss} <span className="muted">cp/move</span></td>
              </RowLink>
            ))}</tbody></table>
          ) : <Empty>Not enough scored moves yet.</Empty>}
        </Card>

        <Card title="Where move orders meet" sub="Popular positions reached by different move orders" db="Neo4j" foot={<Link href="/transpositions">All transpositions →</Link>}>
          {transpositions?.length ? (
            <table className="t"><tbody>{transpositions.map((t: any) => (
              <RowLink key={t.position_id} href={`/positions/${t.position_id}`}>
                <td>
                  <div style={{ fontWeight: 500 }}>{t.opening ?? t.line}</div>
                  <div className="line">{(t.orders ?? []).slice(0, 2).map((o: any) => o.moves.map((m: string, i: number) => (i % 2 ? m : `${i / 2 + 1}.${m}`)).join(" ")).join("  ≡  ")}</div>
                </td>
                <td className="num small nowrap">{t.games} games</td>
              </RowLink>
            ))}</tbody></table>
          ) : <Empty>{transpositions ? "No transpositions yet." : "Graph database offline."}</Empty>}
        </Card>

        <Card title="Most played openings" db="MySQL" foot={<Link href="/openings">All openings →</Link>}>
          <table className="t"><tbody>{openings.map((o: any) => (
            <RowLink key={o.opening_id} href={`/openings/${o.opening_id}`}>
              <td><EcoName eco={o.eco} name={o.name} href={`/openings/${o.opening_id}`} /></td>
              <td className="num small">{o.games}</td>
              <td style={{ width: 160 }} className="hide-sm"><ResultBar w={o.white_wins} d={o.draws} b={o.black_wins} /></td>
            </RowLink>
          ))}</tbody></table>
        </Card>
      </div>
    </>
  );
}
