import Link from "next/link";
import { apiGet, currentUser, qs } from "@/lib/web/api";
import { ActionForm } from "@/components/ActionForm";
import { PlayerFields } from "@/components/PlayerFields";
import { createPlayer } from "@/app/actions";
import { Db, Empty, PageHead, Pager } from "@/components/ui";

export const metadata = { title: "Players · Chess State Explorer" };
const LIMIT = 50;

export default async function PlayersPage({ searchParams }: { searchParams: Promise<{ q?: string; offset?: string }> }) {
  const sp = await searchParams;
  const offset = Math.max(0, Number(sp.offset) || 0);
  const q = sp.q?.trim();
  const [user, data] = await Promise.all([
    currentUser(),
    q ? apiGet(`/search${qs({ q, type: "player", limit: 50 })}`).then(r => r.players).catch(() => [])
      : apiGet(`/players?limit=${LIMIT}&offset=${offset}`),
  ]);
  return (
    <>
      <PageHead title="Players" sub={<>Chess players (not login accounts). Search uses a MySQL <code>FULLTEXT</code> index. <Db kind="MySQL" /></>}>
        <form className="searchbar" method="get">
          <input name="q" placeholder="Search names…" defaultValue={q ?? ""} aria-label="Search players" />
          <button className="btn btn-ghost">Search</button>
        </form>
      </PageHead>
      {user.role === "admin" && (
        <details className="card admin" style={{ marginBottom: 16 }}>
          <summary>+ Add player</summary>
          <ActionForm action={createPlayer} submit="Create player" resetOnSuccess><PlayerFields /></ActionForm>
        </details>
      )}
      <section className="card">
        {data.length ? (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Name</th><th>Title</th><th>Fed.</th><th className="num">Rating</th>{q && <th className="num">Games</th>}</tr></thead>
            <tbody>{data.map((p: any) => (
              <tr key={p.player_id}>
                <td><Link href={`/players/${p.player_id}`}>{p.name}</Link></td>
                <td>{p.title ?? ""}</td><td>{p.federation ?? ""}</td>
                <td className="num">{p.rating ?? "—"}</td>{q && <td className="num">{p.games}</td>}
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{q ? `No player matches “${q}”. (Words under 3 letters are not indexed.)` : "No players yet."}</Empty>}
        {!q && <Pager base="/players" params={{}} offset={offset} limit={LIMIT} count={data.length} />}
      </section>
    </>
  );
}
