import Link from "next/link";
import { apiAll, currentUser } from "@/lib/web/api";
import { ActionForm, Field } from "@/components/ActionForm";
import { createTournament, deleteTournament } from "@/app/actions";
import { Db, Empty, PageHead } from "@/components/ui";

export const metadata = { title: "Tournaments · Chess State Explorer" };

export default async function TournamentsPage() {
  const [user, tournaments] = await Promise.all([currentUser(), apiAll("/tournaments")]);
  return (
    <>
      <PageHead title="Tournaments" sub={<>Events that host games. <Db kind="MySQL" /></>} />
      {user.role === "admin" && (
        <details className="card admin" style={{ marginBottom: 16 }}>
          <summary>+ Add tournament</summary>
          <ActionForm action={createTournament} submit="Create tournament" resetOnSuccess>
            <div className="form-row">
              <Field label="Name *"><input name="name" required maxLength={150} /></Field>
              <Field label="Start date"><input name="date" type="date" min="1000-01-01" /></Field>
              <Field label="Location"><input name="location" maxLength={150} /></Field>
            </div>
          </ActionForm>
        </details>
      )}
      <section className="card">
        {tournaments.length ? (
          <table className="data">
            <thead><tr><th>Name</th><th>Date</th><th>Location</th>{user.role === "admin" && <th />}</tr></thead>
            <tbody>{tournaments.map((t: any) => (
              <tr key={t.tournament_id}>
                <td>{t.name}</td><td>{t.date ?? "—"}</td><td>{t.location ?? "—"}</td>
                {user.role === "admin" && <td><ActionForm inline action={deleteTournament.bind(null, t.tournament_id)} submit="Delete" variant="ghost" confirm={`Delete ${t.name}? Fails if it still hosts games.`} /></td>}
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty>No tournaments.</Empty>}
        <p className="muted small">Deleting a tournament that still hosts games is refused by its <code>ON DELETE RESTRICT</code> foreign key (409). Detach games first via <Link href="/games">game metadata</Link>.</p>
      </section>
    </>
  );
}
