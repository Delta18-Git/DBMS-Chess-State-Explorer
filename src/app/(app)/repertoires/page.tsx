import Link from "next/link";
import { apiAll, apiGet, currentUser } from "@/lib/web/api";
import { ActionForm, Field } from "@/components/ActionForm";
import { createRepertoire } from "@/app/actions";
import { Db, Empty, PageHead } from "@/components/ui";

export const metadata = { title: "Repertoires · Chess State Explorer" };

export default async function RepertoiresPage() {
  const [user, repertoires] = await Promise.all([currentUser(), apiGet("/repertoires?limit=100")]);
  const players = user.role === "admin" ? (await apiAll("/players")).sort((a: any, b: any) => a.name.localeCompare(b.name)) : [];
  return (
    <>
      <PageHead title="Repertoires" sub={<>A player&apos;s prepared moves: one recommended legal move per stored board. <Db kind="MySQL" /></>} />
      {user.role === "admin" && (
        <details className="card admin" style={{ marginBottom: 16 }}>
          <summary>+ New repertoire</summary>
          <ActionForm action={createRepertoire} submit="Create">
            <div className="form-row">
              <Field label="Player *">
                <select name="player_id" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {players.map((p: any) => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Name *"><input name="name" required maxLength={100} placeholder="White: Catalan" /></Field>
            </div>
          </ActionForm>
        </details>
      )}
      <section className="card">
        {repertoires.length ? (
          <table className="data">
            <thead><tr><th>Repertoire</th><th>Player</th><th className="num">Moves</th></tr></thead>
            <tbody>{repertoires.map((r: any) => (
              <tr key={r.repertoire_id}>
                <td><Link href={`/repertoires/${r.repertoire_id}`}>{r.name}</Link></td>
                <td><Link href={`/players/${r.player_id}`}>{r.player_name}</Link></td>
                <td className="num">{r.line_count}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty>No repertoires yet.</Empty>}
      </section>
    </>
  );
}
