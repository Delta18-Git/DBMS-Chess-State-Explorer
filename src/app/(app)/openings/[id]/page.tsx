import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFind, apiGet, currentUser, qs } from "@/lib/web/api";
import { ActionForm } from "@/components/ActionForm";
import { Board } from "@/components/Board";
import { MoveGraph } from "@/components/MoveGraph";
import { RowLink } from "@/components/RowLink";
import { Tabs } from "@/components/Tabs";
import { Icon } from "@/components/Icon";
import { deleteOpening } from "@/app/actions";
import { AdminBar, Avatar, Card, Eco, Empty, PageHead, Pagination, Result, ResultBar, ResultLegend, Stat, Stats, TitleChip, fmtDate, pageOf, pct, totalOf } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const o = /^\d+$/.test((await params).id) ? await apiFind(`/openings/${(await params).id}`) : null;
  return { title: o ? `${o.name} · Chess State Explorer` : "Opening" };
}
const PER_PAGE = 15;

export default async function OpeningPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const o = await apiFind(`/openings/${id}`);
  if (!o) notFound();
  const page = pageOf(sp);
  const [user, games, tree] = await Promise.all([
    currentUser(),
    apiGet(`/games${qs({ opening_id: id, sort: "rating", limit: PER_PAGE, offset: (page - 1) * PER_PAGE })}`),
    o.position ? apiGet(`/graph/positions/${o.position.position_id}/tree?depth=4`).catch(() => null) : null,
  ]);
  const s = o.stats;
  const decided = Number(s.white_wins) + Number(s.draws) + Number(s.black_wins);
  const whiteScore = decided ? (100 * (Number(s.white_wins) + Number(s.draws) / 2)) / decided : null;
  const line = (o.pgn ?? "").replace(/(\d+)\. /g, "$1.");

  return (
    <>
      <PageHead crumbs={[["Openings", "/openings"]]} title={<span className="row" style={{ gap: 10 }}><Eco eco={o.eco} />{o.name}</span>} lead={line ? <span className="line">{line}</span> : undefined}>
        {o.position && <Link href={`/positions/${o.position.position_id}`} className="btn btn-primary"><Icon name="explore" />Explore from here</Link>}
      </PageHead>
      {user.role === "admin" && Number(s.games) === 0 && (
        <AdminBar><ActionForm inline action={deleteOpening.bind(null, o.opening_id)} submit="Delete opening" icon="trash" variant="danger" small confirm={`Delete ${o.name}?`} /></AdminBar>
      )}
      <Stats>
        <Stat label="Games" value={s.games} note={s.first_played ? `${fmtDate(s.first_played)} – ${fmtDate(s.last_played)}` : undefined} />
        <Stat label="White score" value={pct(whiteScore)} note="win = 1, draw = ½" />
        <Stat label="Results" value={<div style={{ paddingTop: 6 }}><ResultBar w={s.white_wins} d={s.draws} b={s.black_wins} /></div>} />
        <Stat label="Average rating" value={s.avg_elo ?? "—"} />
      </Stats>

      <div className="explorer">
        <div className="explorer-board">
          {o.position ? <Board fen={o.position.fen} id="opening" /> : <section className="card"><Empty>No defining position.</Empty></section>}
          {o.position && <Link href={`/positions/${o.position.position_id}`} className="btn btn-ghost"><Icon name="explore" />Play on from here in the explorer</Link>}
        </div>
        <section className="card tabs-card">
          <Tabs initial={sp.tab} tabs={[
            { id: "graph", label: "How games continue", content: tree?.edges?.length
              ? <MoveGraph nodes={tree.nodes} edges={tree.edges} rootId={o.position.position_id} height={520} />
              : <Empty>{tree ? "No continuations stored." : o.position ? "Graph database offline." : "No defining position."}</Empty> },
            { id: "games", label: "Games", count: s.games, content: (
              <>
                {games.length ? <div className="table-wrap"><table className="t">
                  <thead><tr><th>Date</th><th>White</th><th className="center">Result</th><th>Black</th><th className="hide-sm">Event</th><th className="num">Moves</th></tr></thead>
                  <tbody>{games.map((g: any) => (
                    <RowLink key={g.game_id} href={`/games/${g.game_id}`}>
                      <td className="small muted nowrap">{fmtDate(g.date)}</td>
                      <td><TitleChip title={g.white_title} /> {g.white_name} <span className="muted small">{g.white_elo}</span></td>
                      <td className="center"><Result result={g.result} /></td>
                      <td><TitleChip title={g.black_title} /> {g.black_name} <span className="muted small">{g.black_elo}</span></td>
                      <td className="small hide-sm">{g.tournament_name}</td>
                      <td className="num small">{g.plies ? Math.ceil(g.plies / 2) : "—"}</td>
                    </RowLink>
                  ))}</tbody>
                </table></div> : <Empty>No games classified under this opening.</Empty>}
                <Pagination base={`/openings/${id}`} params={{ tab: "games" }} page={page} perPage={PER_PAGE} total={totalOf(games)} />
              </>
            ) },
            { id: "players", label: "Who plays it", count: o.players.length, content: o.players.length ? (
              <table className="t"><thead><tr><th>Player</th><th className="center">Colour</th><th className="num">Games</th><th className="num">Score</th></tr></thead><tbody>{o.players.map((p: any) => (
                <RowLink key={`${p.player_id}${p.color}`} href={`/players/${p.player_id}`}>
                  <td><Link href={`/players/${p.player_id}`} className="person"><Avatar name={p.name} photo={p.photo_url} size="sm" /><span><TitleChip title={p.title} /> <span className="name">{p.name}</span></span></Link></td>
                  <td className="center"><span className="row" style={{ gap: 6, justifyContent: "center" }}><span className={`side-dot ${p.color}`} />{p.color === "w" ? "White" : "Black"}</span></td>
                  <td className="num">{p.games}</td><td className="num">{pct(p.score_pct)}</td>
                </RowLink>
              ))}</tbody></table>
            ) : <Empty>No games yet.</Empty> },
          ]} />
        </section>
      </div>
    </>
  );
}
