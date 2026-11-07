import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFind, apiGet, currentUser, qs } from "@/lib/web/api";
import { ActionForm, Field } from "@/components/ActionForm";
import { Modal } from "@/components/Modal";
import { MoveGraph } from "@/components/MoveGraph";
import { PlayerFields } from "@/components/PlayerFields";
import { RowLink } from "@/components/RowLink";
import { Tabs } from "@/components/Tabs";
import { Icon } from "@/components/Icon";
import { createRepertoire, deletePlayer, updatePlayer } from "@/app/actions";
import { AdminBar, Avatar, Card, Eco, Empty, Flag, Outcome, PageHead, Pagination, Stat, Stats, TitleChip, displayName, fmtDate, moveNo, pageOf, pct, totalOf, EcoName } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const p = /^\d+$/.test((await params).id) ? await apiFind(`/players/${(await params).id}`) : null;
  return { title: p ? `${displayName(p.name)} · Chess State Explorer` : "Player" };
}
const PER_PAGE = 15;

function OpeningTable({ rows }: { rows: any[] }) {
  if (!rows.length) return <Empty>No games with this colour.</Empty>;
  return (
    <table className="t compact"><thead><tr><th>Opening</th><th className="num">Games</th><th className="num">W-D-L</th><th className="num">Score</th></tr></thead>
      <tbody>{rows.slice(0, 12).map(o => (
        <RowLink key={o.opening_id} href={`/openings/${o.opening_id}`}>
          <td><EcoName eco={o.eco} name={o.name} /></td>
          <td className="num">{o.games}</td><td className="num small nowrap">{o.wins}-{o.draws}-{o.losses}</td><td className="num">{pct(o.score_pct)}</td>
        </RowLink>
      ))}</tbody></table>
  );
}

export default async function PlayerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const player = await apiFind(`/players/${id}`);
  if (!player) notFound();
  const color = sp.color === "b" ? "b" : "w";
  const page = pageOf(sp);
  const [user, a, games, repertoires, graph] = await Promise.all([
    currentUser(),
    apiGet(`/analytics/players/${id}?limit=8`),
    apiGet(`/games${qs({ player_id: id, color: sp.games === "w" || sp.games === "b" ? sp.games : undefined, limit: PER_PAGE, offset: (page - 1) * PER_PAGE })}`),
    apiGet(`/repertoires?player_id=${id}`),
    apiGet(`/graph/players/${id}/tree?color=${color}&depth=12`).catch(() => null),
  ]);
  const s = a.summary;
  const decided = Number(s.games) - Number(s.unfinished);
  const score = decided > 0 ? (100 * (Number(s.wins) + Number(s.draws) / 2)) / decided : null;
  const by = (c: string) => a.by_color.find((r: any) => r.color === c);
  const accuracy = new Map(a.accuracy.map((g: any) => [String(g.game_id), g]));
  const first = (c: string) => a.first_moves.filter((m: any) => m.color === c);
  const replies = first("b").reduce((acc: Record<string, any[]>, m: any) => { (acc[m.first_move] ??= []).push(m); return acc; }, {});
  const name = displayName(player.name);
  const age = player.birth_year ? new Date().getFullYear() - player.birth_year : null;

  return (
    <>
      <PageHead crumbs={[["Players", "/players"]]} title={name} />
      {user.role === "admin" && (
        <AdminBar>
          <Modal label="Edit player" icon="edit" title={`Edit ${name}`} className="btn btn-sm">
            <ActionForm action={updatePlayer.bind(null, player.player_id)} submit="Save changes"><PlayerFields p={player} /></ActionForm>
          </Modal>
          <ActionForm inline action={deletePlayer.bind(null, player.player_id)} submit="Delete" icon="trash" variant="danger" small confirm={`Delete ${name}? Refused while they have games or repertoires.`} />
        </AdminBar>
      )}

      <section className="card profile">
        <Avatar name={player.name} photo={player.photo_url} size="lg" />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: "1.35rem" }}><TitleChip title={player.title} /> {name}</h1>
          <div className="meta">
            <Flag code={player.federation} full />
            {player.rating && <span>FIDE <b>{player.rating}</b></span>}
            {age && <span>{age} years (born {player.birth_year})</span>}
            {player.fide_id && <a href={`https://ratings.fide.com/profile/${player.fide_id}`} target="_blank" rel="noreferrer" className="row" style={{ gap: 4 }}>FIDE profile <Icon name="external" /></a>}
            {player.fide_id && <a href={`https://lichess.org/fide/${player.fide_id}`} target="_blank" rel="noreferrer" className="row" style={{ gap: 4 }}>Lichess <Icon name="external" /></a>}
          </div>
        </div>
        <div className="big-score"><strong>{pct(score)}</strong><span className="small muted">score in {s.games} games</span></div>
      </section>

      <Stats>
        <Stat label="Record" value={`${s.wins}–${s.draws}–${s.losses}`} note="wins – draws – losses" />
        <Stat label="As White" value={pct(by("w")?.score_pct)} note={by("w") ? `${by("w").games} games · opp. avg ${by("w").avg_opponent_elo ?? "—"}` : "no games"} />
        <Stat label="As Black" value={pct(by("b")?.score_pct)} note={by("b") ? `${by("b").games} games · opp. avg ${by("b").avg_opponent_elo ?? "—"}` : "no games"} />
        <Stat label="Avg centipawn loss" value={s.average_cp_loss === null ? "—" : Number(s.average_cp_loss).toFixed(0)} note={`over ${s.evaluated_plies} scored moves`} />
        <Stat label="Blunders" value={s.blunders} note={`${pct(s.blunder_rate_pct, 1)} of moves (from CALL sp_player_summary)`} />
      </Stats>

      <section className="card">
        <Tabs initial={sp.tab} tabs={[
          { id: "openings", label: "Openings", content: (
            <div className="grid grid-2" style={{ gap: 0 }}>
              <div style={{ borderRight: "1px solid var(--line)" }}>
                <div className="card-body"><h3>As White</h3>{first("w").length > 0 && <div className="small muted">First move: {first("w").map((m: any) => <span key={m.first_move} className="mono" style={{ marginRight: 10 }}>1.{m.first_move} ×{m.games}</span>)}</div>}</div>
                <OpeningTable rows={a.openings.filter((o: any) => o.color === "w")} />
              </div>
              <div>
                <div className="card-body"><h3>As Black</h3>{Object.keys(replies).length > 0 && <div className="small muted">Replies: {Object.entries(replies).slice(0, 3).map(([m, r]) => <span key={m} className="mono" style={{ marginRight: 10 }}>1.{m} {(r as any[]).map(x => `${x.reply}×${x.games}`).join(" ")}</span>)}</div>}</div>
                <OpeningTable rows={a.openings.filter((o: any) => o.color === "b")} />
              </div>
            </div>
          ) },
          { id: "graph", label: "Opening graph", content: (
            <>
              <div className="filters">
                <span className="small muted" style={{ alignSelf: "center" }}>Every move order in their own games (first 12 moves). Ringed boards: two of their move orders transpose.</span>
                <div className="seg" style={{ marginLeft: "auto" }}>
                  <Link scroll={false} href={`/players/${id}?color=w&tab=graph`} aria-current={color === "w" ? "true" : undefined}>As White</Link>
                  <Link scroll={false} href={`/players/${id}?color=b&tab=graph`} aria-current={color === "b" ? "true" : undefined}>As Black</Link>
                </div>
              </div>
              {!graph ? <Empty>Graph database offline.</Empty> : graph.edges.length ? <MoveGraph nodes={graph.nodes} edges={graph.edges} height={540} /> : <Empty>No games with this colour.</Empty>}
            </>
          ) },
          { id: "games", label: "Games", count: s.games, content: (
            <>
              <div className="filters">
                <div className="seg">{[[undefined, "All"], ["w", "As White"], ["b", "As Black"]].map(([v, l]) => <Link key={l} scroll={false} href={`/players/${id}${qs({ games: v, color: sp.color, tab: "games" })}`} aria-current={sp.games === v ? "true" : undefined}>{l}</Link>)}</div>
              </div>
              <div className="table-wrap"><table className="t">
                <thead><tr><th>Date</th><th>Opponent</th><th className="center">Result</th><th>Opening</th><th className="num" title="Average centipawn loss in this game (lower is better)">Avg loss</th></tr></thead>
                <tbody>{games.map((g: any) => {
                  const white = String(g.white_player_id) === String(player.player_id);
                  const sc = g.result === "1/2-1/2" ? 0.5 : g.result === (white ? "1-0" : "0-1") ? 1 : g.result === "*" ? null : 0;
                  const acc: any = accuracy.get(String(g.game_id));
                  return (
                    <RowLink key={g.game_id} href={`/games/${g.game_id}`}>
                      <td className="small muted nowrap">{fmtDate(g.date)}</td>
                      <td><span className="row" style={{ gap: 8, flexWrap: "nowrap" }}><span className={`side-dot ${white ? "" : "b"}`} title={white ? "Played White" : "Played Black"} />
                        <Link href={`/players/${white ? g.black_player_id : g.white_player_id}`} className="person"><span><TitleChip title={white ? g.black_title : g.white_title} /> <span className="name">{white ? g.black_name : g.white_name}</span> <span className="meta">{white ? g.black_elo : g.white_elo}</span></span></Link></span></td>
                      <td className="center"><Outcome score={sc} /></td>
                      <td className="small"><EcoName eco={g.eco} name={g.opening_name} /></td>
                      <td className="num small">{acc ? Number(acc.avg_cp_loss).toFixed(0) : "—"}</td>
                    </RowLink>
                  );
                })}</tbody>
              </table></div>
              <Pagination base={`/players/${id}`} params={{ games: sp.games, color: sp.color, tab: "games" }} page={page} perPage={PER_PAGE} total={totalOf(games)} />
            </>
          ) },
          { id: "blunders", label: "Worst moves", count: a.blunders.length, content: a.blunders.length ? (
            <table className="t"><thead><tr><th>Move</th><th>Opponent</th><th>Stockfish preferred</th><th className="num">Lost</th></tr></thead><tbody>{a.blunders.map((b: any) => (
              <RowLink key={`${b.game_id}-${b.ply_no}`} href={`/games/${b.game_id}?ply=${b.ply_no}`}>
                <td className="san">{moveNo(b.ply_no)} {b.move_san}</td>
                <td className="small">{b.opponent_name} <span className="muted">{fmtDate(b.date)}</span></td>
                <td className="san">{b.best_move_san && b.best_move_san !== b.move_san ? b.best_move_san : "—"}</td>
                <td className="num"><span className="q-blunder">−{(Number(b.cp_loss) / 100).toFixed(1)}</span></td>
              </RowLink>
            ))}</tbody></table>
          ) : <Empty>No blunders among scored moves.</Empty> },
          { id: "repertoires", label: "Repertoires", count: repertoires.length, content: (
            <>
              <div className="filters">
                <Modal label="New repertoire" icon="plus" title={`New repertoire for ${name}`} className="btn btn-ghost btn-sm">
                  <ActionForm action={createRepertoire} submit="Create repertoire">
                    <input type="hidden" name="player_id" value={player.player_id} />
                    <div className="form-row">
                      <Field label="Name"><input name="name" required maxLength={100} defaultValue={`${player.name.split(",")[0]} as White`} /></Field>
                      <Field label="Colour"><select name="color" defaultValue="w"><option value="w">White</option><option value="b">Black</option></select></Field>
                    </div>
                    <label className="row small"><input type="checkbox" name="build" defaultChecked style={{ height: "auto" }} /> Fill it with their most-played move at each turn (first <input name="moves" type="number" defaultValue={10} min={1} max={30} style={{ width: 64 }} /> moves)</label>
                  </ActionForm>
                </Modal>
              </div>
              {repertoires.length ? <table className="t"><tbody>{repertoires.map((r: any) => (
                <RowLink key={r.repertoire_id} href={`/repertoires/${r.repertoire_id}`}><td><Link href={`/repertoires/${r.repertoire_id}`}>{r.name}</Link></td><td className="num small muted">{r.line_count} prepared moves</td></RowLink>
              ))}</tbody></table> : <Empty>None yet.</Empty>}
            </>
          ) },
        ]} />
      </section>
    </>
  );
}
