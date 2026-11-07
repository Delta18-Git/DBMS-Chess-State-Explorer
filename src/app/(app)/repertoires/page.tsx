import Link from "next/link";
import { apiAll, apiGet } from "@/lib/web/api";
import { ActionForm, Field } from "@/components/ActionForm";
import { Modal } from "@/components/Modal";
import { RowLink } from "@/components/RowLink";
import { createRepertoire } from "@/app/actions";
import { Avatar, Card, Empty, PageHead, TitleChip, fmtDate } from "@/components/ui";

export const metadata = { title: "Repertoires · Chess State Explorer" };

export default async function RepertoiresPage() {
  const [repertoires, players] = await Promise.all([apiGet("/repertoires?limit=100"), apiAll("/players?sort=name")]);
  return (
    <>
      <PageHead title="Repertoires" lead="A repertoire is the move a player intends to play in each position. Build one from a player's own games, then see every game where they left it: useful to prepare against them, or to check your own consistency.">
        <Modal label="New repertoire" icon="plus" title="New repertoire" className="btn btn-primary">
          <ActionForm action={createRepertoire} submit="Create repertoire">
            <div className="form-row">
              <Field label="Player"><select name="player_id" required defaultValue=""><option value="" disabled>Choose…</option>{players.map((p: any) => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}</select></Field>
              <Field label="Colour"><select name="color" defaultValue="w"><option value="w">White</option><option value="b">Black</option></select></Field>
            </div>
            <Field label="Name"><input name="name" required maxLength={100} placeholder="e.g. Gukesh vs 1.e4" /></Field>
            <label className="row small"><input type="checkbox" name="build" defaultChecked style={{ height: "auto" }} /> Fill it with their most-played move at each of their turns, first <input name="moves" type="number" defaultValue={10} min={1} max={30} style={{ width: 64 }} /> moves</label>
            <p className="tiny muted">Any signed-in user can create repertoires; you can edit only your own (admins can edit all).</p>
          </ActionForm>
        </Modal>
      </PageHead>
      <Card>
        {repertoires.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Repertoire</th><th>Player</th><th>Colour</th><th className="num">Prepared moves</th><th className="hide-sm">Owner</th><th className="num hide-sm">Created</th></tr></thead>
            <tbody>{repertoires.map((r: any) => (
              <RowLink key={r.repertoire_id} href={`/repertoires/${r.repertoire_id}`}>
                <td><Link href={`/repertoires/${r.repertoire_id}`} style={{ color: "var(--ink)", fontWeight: 500 }}>{r.name}</Link></td>
                <td><Link href={`/players/${r.player_id}`} className="person"><Avatar name={r.player_name} photo={r.player_photo} size="sm" /><span className="truncate"><TitleChip title={r.player_title} /> <span className="name">{r.player_name}</span></span></Link></td>
                <td><span className="row" style={{ gap: 6 }}><span className={`side-dot ${r.color}`} />{r.color === "w" ? "White" : "Black"}</span></td>
                <td className="num">{r.line_count}</td>
                <td className="small muted hide-sm">{r.owner_name ?? r.owner_email ?? "—"}</td>
                <td className="num small muted hide-sm">{fmtDate(r.created_at?.slice(0, 10))}</td>
              </RowLink>
            ))}</tbody>
          </table></div>
        ) : <Empty>No repertoires yet. Create one from any player's games.</Empty>}
      </Card>
    </>
  );
}
