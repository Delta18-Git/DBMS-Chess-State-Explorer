import Link from "next/link";
import { apiAll, apiGet, currentUser } from "@/lib/web/api";
import { ActionForm, Field } from "@/components/ActionForm";
import { createOpening, deleteOpening } from "@/app/actions";
import { Db, Empty, PageHead, ResultBar, ResultLegend, n, pct } from "@/components/ui";

export const metadata = { title: "Openings · Chess State Explorer" };

export default async function OpeningsPage({ searchParams }: { searchParams: Promise<{ min_games?: string }> }) {
  const minGames = Math.max(1, Number((await searchParams).min_games) || 1);
  const [user, stats, openings] = await Promise.all([currentUser(), apiAll(`/analytics/openings?min_games=${minGames}`), apiAll("/openings")]);
  const played = new Set(stats.map((s: any) => String(s.opening_id)));
  const unused = openings.filter((o: any) => !played.has(String(o.opening_id)));
  return (
    <>
      <PageHead title="Openings" sub={<>Results per opening: <code>JOIN … GROUP BY … HAVING COUNT(*) &gt;= {minGames} ORDER BY</code>. <Db kind="MySQL" /></>}>
        <form className="searchbar" method="get">
          <label className="row small">Min games <input name="min_games" type="number" min={1} defaultValue={minGames} style={{ width: 70 }} /></label>
          <button className="btn btn-ghost">Apply</button>
        </form>
      </PageHead>
      {user.role === "admin" && (
        <details className="card admin" style={{ marginBottom: 16 }}>
          <summary>+ Add opening</summary>
          <ActionForm action={createOpening} submit="Create opening" resetOnSuccess>
            <div className="form-row">
              <Field label="ECO *" hint="A00–E99"><input name="eco" required pattern="[A-Ea-e][0-9]{2}" maxLength={3} /></Field>
              <Field label="Name *"><input name="name" required maxLength={150} /></Field>
            </div>
          </ActionForm>
        </details>
      )}
      <section className="card">
        {stats.length ? (
          <>
            <div className="table-wrap"><table className="data">
              <thead><tr><th>ECO</th><th>Opening</th><th className="num">Games</th><th>Results</th><th className="num">White wins</th><th className="num">Draws</th><th className="num">Black wins</th><th className="num">White score</th></tr></thead>
              <tbody>{stats.map((o: any) => (
                <tr key={o.opening_id}>
                  <td className="mono">{o.eco}</td>
                  <td><Link href={`/games?opening_id=${o.opening_id}`}>{o.name}</Link></td>
                  <td className="num">{o.games}</td>
                  <td><ResultBar w={n(o.white_wins)!} d={n(o.draws)!} b={n(o.black_wins)!} /></td>
                  <td className="num">{o.white_wins}</td><td className="num">{o.draws}</td><td className="num">{o.black_wins}</td>
                  <td className="num">{pct(o.white_score_pct, 1)}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <ResultLegend />
          </>
        ) : <Empty>No opening has {minGames}+ games.</Empty>}
      </section>
      {unused.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Openings without games</h2>
          <table className="data"><tbody>{unused.map((o: any) => (
            <tr key={o.opening_id}><td className="mono">{o.eco}</td><td>{o.name}</td>
              <td>{user.role === "admin" && <ActionForm inline action={deleteOpening.bind(null, o.opening_id)} submit="Delete" variant="ghost" confirm={`Delete ${o.name}?`} />}</td></tr>
          ))}</tbody></table>
        </section>
      )}
    </>
  );
}
