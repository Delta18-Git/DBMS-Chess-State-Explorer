import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFind, apiGet, currentUser } from "@/lib/web/api";
import { Board } from "@/components/Board";
import { ActionForm, Field } from "@/components/ActionForm";
import { addLine, deleteLine, deleteRepertoire } from "@/app/actions";
import { Db, Empty, PageHead } from "@/components/ui";

export default async function RepertoirePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const rep = await apiFind(`/repertoires/${id}`);
  if (!rep) notFound();
  const [user, player] = await Promise.all([currentUser(), apiGet(`/players/${rep.player_id}`)]);
  const admin = user.role === "admin";
  return (
    <>
      <PageHead title={rep.name} sub={<>Repertoire of <Link href={`/players/${player.player_id}`}>{player.name}</Link> · {rep.lines.length} recommended move(s) <Db kind="MySQL" /></>}>
        <Link href="/repertoires" className="btn btn-ghost">← Repertoires</Link>
      </PageHead>
      {admin && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2>Add a recommended move</h2>
          <ActionForm action={addLine.bind(null, rep.repertoire_id)} submit="Add move" resetOnSuccess>
            <div className="form-row">
              <Field label="Start position ID *" hint="Open any board in the Position explorer and use its #id"><input name="start_position_id" type="number" min={1} required /></Field>
              <Field label="Move (SAN) *" hint="Checked against that board: illegal moves are rejected"><input name="move_san" required maxLength={10} placeholder="Nf3" /></Field>
            </div>
          </ActionForm>
        </section>
      )}
      <section className="card">
        {rep.lines.length ? (
          <div className="grid grid-3">
            {rep.lines.map((l: any) => (
              <div key={l.repertoire_line_id} className="stack" style={{ gap: 6 }}>
                <Board fen={l.fen} id={`l${l.repertoire_line_id}`} />
                <div className="row">
                  <span>Play <span className="san">{l.move_san}</span> in <Link href={`/positions/${l.start_position_id}`}>#{l.start_position_id}</Link></span>
                  {admin && <ActionForm inline action={deleteLine.bind(null, rep.repertoire_id, l.repertoire_line_id)} submit="Remove" variant="ghost" />}
                </div>
              </div>
            ))}
          </div>
        ) : <Empty>No moves yet.</Empty>}
      </section>
      {admin && (
        <div style={{ marginTop: 16 }}>
          <ActionForm action={deleteRepertoire.bind(null, rep.repertoire_id)} submit="Delete repertoire" variant="danger" confirm="Delete this repertoire and all its lines?" />
        </div>
      )}
    </>
  );
}
