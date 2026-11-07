import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFind, apiGet, currentUser, qs } from "@/lib/web/api";
import { ActionForm, Field } from "@/components/ActionForm";
import { Modal } from "@/components/Modal";
import { RowLink } from "@/components/RowLink";
import { Tabs } from "@/components/Tabs";
import { Icon } from "@/components/Icon";
import { analyse, deleteTournament, importLichess, updateTournament } from "@/app/actions";
import { AdminBar, Avatar, Card, Eco, Empty, Flag, PageHead, Pagination, Result, ResultBar, ResultLegend, Stat, Stats, TitleChip, dateRange, pageOf, roundLabel, totalOf, EcoName } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const t = /^\d+$/.test((await params).id) ? await apiFind(`/tournaments/${(await params).id}`) : null;
  return { title: t ? `${t.name} · Chess State Explorer` : "Tournament" };
}
const PER_PAGE = 20;

// Performance rating from score % and average opponent (logistic approximation of the FIDE table).
function performance(points: number, games: number, avgOpp: number | null) {
  if (!games || avgOpp === null) return null;
  const p = Math.min(0.99, Math.max(0.01, points / games));
  return Math.round(avgOpp + 400 * Math.log10(p / (1 - p)));
}

export default async function TournamentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const t = await apiFind(`/tournaments/${id}`);
  if (!t) notFound();
  const page = pageOf(sp);
  const [user, games] = await Promise.all([currentUser(), apiGet(`/games${qs({ tournament_id: id, sort: "round", limit: PER_PAGE, offset: (page - 1) * PER_PAGE })}`)]);
  const s = t.summary;

  return (
    <>
      <PageHead crumbs={[["Tournaments", "/tournaments"]]} title={t.name}>
        {t.source_url && <a href={t.source_url} target="_blank" rel="noreferrer" className="btn btn-ghost"><Icon name="external" />Lichess broadcast</a>}
      </PageHead>
      {user.role === "admin" && (
        <AdminBar>
          {t.source_url && (
            <ActionForm inline action={importLichess.bind(null, true)} submit="Fetch new games from Lichess" icon="refresh" variant="solid" small>
              <input type="hidden" name="source" value={t.source_url} />
            </ActionForm>
          )}
          <ActionForm inline action={analyse.bind(null, { tournament_id: t.tournament_id })} submit="Score unscored moves" icon="cpu" small />
          <Modal label="Edit" icon="edit" title="Edit tournament" className="btn btn-sm">
            <ActionForm action={updateTournament.bind(null, t.tournament_id)} submit="Save">
              <Field label="Name"><input name="name" required maxLength={150} defaultValue={t.name} /></Field>
              <div className="form-row">
                <Field label="Start date"><input name="date" type="date" defaultValue={t.date ?? ""} /></Field>
                <Field label="Location"><input name="location" maxLength={150} defaultValue={t.location ?? ""} /></Field>
              </div>
            </ActionForm>
          </Modal>
          <ActionForm inline action={deleteTournament.bind(null, t.tournament_id)} submit="Delete" icon="trash" variant="danger" small confirm="Delete this tournament? Refused while it still has games (foreign key)." />
        </AdminBar>
      )}

      <section className="card card-body" style={{ marginBottom: 16 }}>
        <div>
          <dl className="facts-list" style={{ margin: 0 }}>
            <div><dt>Dates</dt><dd>{dateRange(t.date, t.end_date)}</dd></div>
            <div><dt>Location</dt><dd>{t.location ?? "—"}</dd></div>
            <div><dt>Format</dt><dd>{t.format ?? "—"}</dd></div>
            <div><dt>Time control</dt><dd>{t.time_control ?? "—"}</dd></div>
          </dl>
        </div>
      </section>

      <Stats>
        <Stat label="Games" value={s.games} note={`${s.rounds} rounds`} />
        <Stat label="Average rating" value={s.avg_elo ?? "—"} />
        <Stat label="White wins" value={s.white_wins} note={`${Math.round((100 * s.white_wins) / (s.games || 1))}%`} />
        <Stat label="Draws" value={s.draws} note={`${Math.round((100 * s.draws) / (s.games || 1))}%`} />
        <Stat label="Black wins" value={s.black_wins} note={`${Math.round((100 * s.black_wins) / (s.games || 1))}%`} />
      </Stats>

      <section className="card">
        <Tabs initial={sp.tab} tabs={[
          { id: "standings", label: "Standings", count: t.standings.length, content: <>
          <div className="card-body small muted" style={{ paddingBottom: 0 }}>Points from the stored games (<code>RANK()</code> over <code>v_player_game</code>); performance rating from score and average opponent.</div>
          {t.standings.length ? (
            <div className="table-wrap"><table className="t">
              <thead><tr><th className="num">#</th><th>Player</th><th className="hide-sm">Fed.</th><th className="num">Rating</th><th className="num">Points</th><th className="num">Games</th><th className="num hide-sm">W-D-L</th><th className="num" title="Tournament performance rating">Perf.</th></tr></thead>
              <tbody>{t.standings.map((p: any) => (
                <RowLink key={p.player_id} href={`/players/${p.player_id}`}>
                  <td className="num muted">{p.place}</td>
                  <td><Link href={`/players/${p.player_id}`} className="person"><Avatar name={p.name} photo={p.photo_url} size="sm" /><span className="truncate"><TitleChip title={p.title} /> <span className="name">{p.name}</span></span></Link></td>
                  <td className="hide-sm"><Flag code={p.federation} /></td>
                  <td className="num">{p.elo ?? "—"}</td>
                  <td className="num"><b>{Number(p.points).toString().replace(".5", "½").replace(/^0½/, "½")}</b></td>
                  <td className="num">{p.games}</td>
                  <td className="num small hide-sm">{p.wins}-{p.draws}-{p.losses}</td>
                  <td className="num">{performance(Number(p.points), Number(p.games), p.avg_opponent_elo === null ? null : Number(p.avg_opponent_elo)) ?? "—"}</td>
                </RowLink>
              ))}</tbody>
            </table></div>
          ) : <Empty>No finished games yet.</Empty>}
          </> },
          { id: "games", label: "Games", count: s.games, content: <>
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Round</th><th>White</th><th className="center">Result</th><th>Black</th><th>Opening</th><th className="num">Moves</th></tr></thead>
          <tbody>{games.map((g: any) => (
            <RowLink key={g.game_id} href={`/games/${g.game_id}`}>
              <td className="small nowrap">{roundLabel(g.round, true) ?? "—"}</td>
              <td><span className="truncate"><TitleChip title={g.white_title} /> {g.white_name} <span className="muted small">{g.white_elo}</span></span></td>
              <td className="center"><Result result={g.result} /></td>
              <td><span className="truncate"><TitleChip title={g.black_title} /> {g.black_name} <span className="muted small">{g.black_elo}</span></span></td>
              <td className="small"><EcoName eco={g.eco} name={g.opening_name} /></td>
              <td className="num small">{g.plies ? Math.ceil(g.plies / 2) : "—"}</td>
            </RowLink>
          ))}</tbody>
        </table></div>
        <Pagination base={`/tournaments/${id}`} params={{ tab: "games" }} page={page} perPage={PER_PAGE} total={totalOf(games)} />

          </> },
          { id: "openings", label: "Openings", count: t.openings.length, content: <>
          {t.openings.length ? <table className="t"><thead><tr><th>Opening</th><th className="num">Games</th><th className="center">White / draw / Black</th></tr></thead><tbody>{t.openings.map((o: any) => (
            <RowLink key={o.opening_id} href={`/games${qs({ tournament_id: id, opening_id: o.opening_id })}`}>
              <td><EcoName eco={o.eco} name={o.name} /></td>
              <td className="num">{o.games}</td>
              <td style={{ width: 200 }}><ResultBar w={o.white_wins} d={o.draws} b={o.black_wins} /></td>
            </RowLink>
          ))}</tbody></table> : <Empty>No classified openings.</Empty>}
          <div className="card-foot"><ResultLegend /></div>
          </> },
        ]} />
      </section>

    </>
  );
}
