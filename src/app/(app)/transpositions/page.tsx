import Link from "next/link";
import { apiGet, qs } from "@/lib/web/api";
import { AutoForm } from "@/components/AutoForm";
import { Board } from "@/components/Board";
import { Card, Eco, Empty, PageHead, Pagination, pageOf, totalOf } from "@/components/ui";

export const metadata = { title: "Transpositions · Chess State Explorer" };
const PER_PAGE = 12;
const FAMILIES: [string, string][] = [["A", "A · Flank"], ["B", "B · Semi-open"], ["C", "C · Open & French"], ["D", "D · Closed"], ["E", "E · Indian"]];

function Orders({ orders }: { orders: { moves: string[]; played_by: number }[] }) {
  const base = orders[0]?.moves ?? [];
  return (
    <div className="stack-sm">
      {orders.slice(0, 3).map((o, k) => (
        <div key={k} className="line">
          {o.moves.map((m, i) => <span key={i}>{i % 2 === 0 ? `${i / 2 + 1}.` : ""}{k && m !== base[i] ? <span className="diff">{m}</span> : m} </span>)}
          <span className="tiny muted"> · {o.played_by ? `${o.played_by} game${o.played_by === 1 ? "" : "s"}` : "combined from different games"}</span>
        </div>
      ))}
    </div>
  );
}

export default async function TranspositionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = pageOf(sp);
  const filters = { eco: sp.eco, min_games: sp.min_games, max_ply: sp.max_ply, sort: sp.sort };
  const rows = await apiGet(`/graph/transpositions${qs({ ...filters, limit: PER_PAGE, offset: (page - 1) * PER_PAGE })}`).catch(() => null);

  return (
    <>
      <PageHead title="Transpositions" lead="Positions you can reach by different move orders. Knowing them lets you dodge an opponent's preparation or recognise a familiar position in disguise." />
      <section className="card">
        <AutoForm>
          <label className="field"><span className="field-label">Opening family</span>
            <select name="eco" defaultValue={sp.eco ?? ""}><option value="">Any</option>{FAMILIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="field"><span className="field-label">Reached by at least</span>
            <select name="min_games" defaultValue={sp.min_games ?? ""}><option value="">1 game</option><option value="2">2 games</option><option value="3">3 games</option><option value="5">5 games</option><option value="10">10 games</option></select>
          </label>
          <label className="field"><span className="field-label">Within</span>
            <select name="max_ply" defaultValue={sp.max_ply ?? ""}><option value="">Any move</option><option value="8">First 4 moves</option><option value="16">First 8 moves</option><option value="24">First 12 moves</option></select>
          </label>
          <label className="field"><span className="field-label">Sort</span>
            <select name="sort" defaultValue={sp.sort ?? "games"}><option value="games">Most games</option><option value="routes">Most move orders</option><option value="early">Earliest in the game</option></select>
          </label>
          {Object.values(filters).some(Boolean) && <Link href="/transpositions" className="btn btn-ghost" style={{ alignSelf: "flex-end" }}>Clear</Link>}
        </AutoForm>
        {!rows ? <Empty>Graph database offline.</Empty> : !rows.length ? <Empty>No transposition matches these filters.</Empty> : (
          <div className="grid grid-2" style={{ padding: 16 }}>
            {rows.map((t: any) => (
              <Card key={t.position_id}
                title={<Link href={`/positions/${t.position_id}`} style={{ color: "var(--ink)" }}>{t.opening ?? "Unnamed position"}</Link>}
                sub={<span className="row" style={{ gap: 6 }}>{t.eco && <Eco eco={t.eco} />}{t.games} game{t.games === 1 ? "" : "s"} · entered from {t.routes} different positions · move {Math.ceil(t.ply / 2)}</span>}
                foot={<Link href={`/positions/${t.position_id}`}>Open in explorer →</Link>}>
                <div className="card-body" style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
                  <Link href={`/positions/${t.position_id}`}><Board fen={t.fen} id={`t${t.position_id}`} notation={false} /></Link>
                  <Orders orders={t.orders} />
                </div>
              </Card>
            ))}
          </div>
        )}
        {rows && <Pagination base="/transpositions" params={filters} page={page} perPage={PER_PAGE} total={totalOf(rows)} />}
      </section>
    </>
  );
}
