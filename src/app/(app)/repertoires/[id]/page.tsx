import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFind } from "@/lib/web/api";
import { ActionForm, Field } from "@/components/ActionForm";
import { Modal } from "@/components/Modal";
import { RowLink } from "@/components/RowLink";
import { Tabs } from "@/components/Tabs";
import { addLine, buildRepertoire, deleteLine, deleteRepertoire } from "@/app/actions";
import { Avatar, Card, Empty, PageHead, Result, Stat, Stats, TitleChip, displayName, fmtDate, moveNo } from "@/components/ui";

export const metadata = { title: "Repertoire · Chess State Explorer" };

export default async function RepertoirePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ all?: string; tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { all } = sp;
  if (!/^\d+$/.test(id)) notFound();
  const rep = await apiFind(`/repertoires/${id}`);
  if (!rep) notFound();
  const colour = rep.color === "w" ? "White" : "Black";
  const followed = rep.lines.reduce((s: number, l: any) => s + Number(l.followed), 0);
  const deviated = rep.lines.reduce((s: number, l: any) => s + Number(l.deviated), 0);
  const shown = all ? rep.lines : rep.lines.slice(0, 30);

  return (
    <>
      <PageHead crumbs={[["Repertoires", "/repertoires"]]} title={rep.name}
        lead={<span className="row" style={{ gap: 8 }}>
          <Link href={`/players/${rep.player_id}`} className="person"><Avatar name={rep.player_name} photo={rep.player_photo} size="sm" /><span><TitleChip title={rep.player_title} /> {displayName(rep.player_name)}</span></Link>
          <span className="muted">·</span><span className="row" style={{ gap: 6 }}><span className={`side-dot ${rep.color}`} />as {colour}</span>
          <span className="muted">· by {rep.owner_name ?? "unknown"}</span>
        </span>}>
        {rep.can_edit && (
          <>
            <Modal label="Fill from games" icon="refresh" title="Fill from the player's games" className="btn btn-ghost">
              <ActionForm action={buildRepertoire.bind(null, rep.repertoire_id)} submit="Add their most-played moves">
                <p className="small ink-2">At every position where it was {displayName(rep.player_name)}'s turn as {colour}, keep the move they played most often. Positions that already have a prepared move are left alone.</p>
                <div className="form-row">
                  <Field label="First N moves"><input name="moves" type="number" defaultValue={10} min={1} max={30} /></Field>
                  <Field label="Played at least" hint="games"><input name="min_games" type="number" defaultValue={1} min={1} max={100} /></Field>
                </div>
              </ActionForm>
            </Modal>
            <Modal label="Add a move" icon="plus" title="Add a prepared move" className="btn btn-ghost">
              <ActionForm action={addLine.bind(null, rep.repertoire_id)} submit="Add move" resetOnSuccess>
                <Field label="Position" hint="The moves from the start that lead to it"><input name="moves" required placeholder="1. e4 c5 2. Nf3" /></Field>
                <Field label="Prepared move (SAN)" hint="Checked for legality in that position"><input name="move_san" required maxLength={10} placeholder="d6" /></Field>
              </ActionForm>
            </Modal>
            <ActionForm inline action={deleteRepertoire.bind(null, rep.repertoire_id)} submit="Delete" icon="trash" variant="danger" confirm="Delete this repertoire and all its moves?" />
          </>
        )}
      </PageHead>

      <Stats>
        <Stat label="Prepared moves" value={rep.lines.length} />
        <Stat label="Times followed" value={followed} note="the player chose the prepared move" />
        <Stat label="Deviations" value={deviated} note="the player chose something else" />
        <Stat label="Consistency" value={followed + deviated ? `${Math.round((100 * followed) / (followed + deviated))}%` : "—"} />
      </Stats>

      <section className="card">
        <Tabs initial={sp.tab} tabs={[
          { id: "deviations", label: "Where they deviated", count: rep.deviations.length, content: <>
            <div className="card-body small muted" style={{ paddingBottom: 0 }}>Games where the player reached a prepared position and played something else.</div>
          {rep.deviations.length ? <div className="table-wrap"><table className="t compact">
            <thead><tr><th>Opponent</th><th>Move</th><th>Prepared → played</th><th className="center">Result</th></tr></thead>
            <tbody>{rep.deviations.map((d: any) => (
              <RowLink key={`${d.game_id}-${d.ply_no}`} href={`/games/${d.game_id}?ply=${d.ply_no}`}>
                <td className="small"><div className="truncate" style={{ maxWidth: 180 }}>{d.opponent_name}</div><div className="tiny muted">{fmtDate(d.date)}</div></td>
                <td className="small mono">{moveNo(d.ply_no)}</td>
                <td className="mono small"><span className="muted">{d.prepared}</span> → <b>{d.played}</b>{d.cp_loss !== null && Number(d.cp_loss) >= 100 && <span className="q-blunder"> −{(Number(d.cp_loss) / 100).toFixed(1)}</span>}</td>
                <td className="center"><Result result={d.result} /></td>
              </RowLink>
            ))}</tbody>
          </table></div> : <Empty>No deviations: every time they reached a prepared position they played the prepared move.</Empty>}
          </> },
          { id: "moves", label: "Prepared moves", count: rep.lines.length, content: <>
          {shown.length ? <div className="table-wrap"><table className="t compact">
            <thead><tr><th>Position</th><th>Play</th><th className="num" title="followed / deviated">Kept</th>{rep.can_edit && <th />}</tr></thead>
            <tbody>{shown.map((l: any) => (
              <RowLink key={l.repertoire_line_id} href={`/positions/${l.start_position_id}`}>
                <td className="line" style={{ maxWidth: 300 }}>{l.line || "Starting position"}{l.opening && <div className="tiny muted truncate">{l.opening}</div>}</td>
                <td><span className="san">{l.move_san}</span></td>
                <td className="num small">{l.followed}/{Number(l.followed) + Number(l.deviated)}</td>
                {rep.can_edit && <td className="num"><ActionForm inline action={deleteLine.bind(null, rep.repertoire_id, l.repertoire_line_id)} submit="Remove" variant="ghost" small /></td>}
              </RowLink>
            ))}</tbody>
          </table></div> : <Empty>No prepared moves yet. Use “Fill from games” or “Add a move”.</Empty>}
            {rep.lines.length > 30 && !all && <div className="card-foot"><Link href={`/repertoires/${id}?all=1&tab=moves`} scroll={false}>Show all {rep.lines.length}</Link></div>}
          </> },
        ]} />
      </section>
    </>
  );
}
