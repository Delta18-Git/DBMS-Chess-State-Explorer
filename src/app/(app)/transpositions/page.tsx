import Link from "next/link";
import { apiGet } from "@/lib/web/api";
import { Board } from "@/components/Board";
import { Db, Empty, PageHead, Pager } from "@/components/ui";

export const metadata = { title: "Transpositions · Chess State Explorer" };
const LIMIT = 20;

export default async function TranspositionsPage({ searchParams }: { searchParams: Promise<{ offset?: string }> }) {
  const offset = Math.max(0, Number((await searchParams).offset) || 0);
  const [rows, stats] = await Promise.all([
    apiGet(`/graph/transpositions?limit=${LIMIT}&offset=${offset}`).catch(() => null),
    apiGet("/graph/stats").catch(() => null),
  ]);
  return (
    <>
      <PageHead title="Transpositions" sub={<>Boards entered from two or more different previous boards (in-degree ≥ 2 in the move graph). <Db kind="Neo4j" /></>} />
      {stats && (
        <p className="callout small">
          Graph: <b>{stats.graph.nodes}</b> position nodes, <b>{stats.graph.edges}</b> aggregated <code>MOVE</code> edges, <b>{stats.graph.transpositions}</b> merge points, <b>{stats.graph.branch_points}</b> branch points.
          {Number(stats.mysql.pending_changes) > 0 && <> ⚠ {stats.mysql.pending_changes} MySQL change(s) waiting in the outbox. <Link href="/admin">Sync now</Link>.</>}
        </p>
      )}
      {!rows ? <Empty>Graph database offline.</Empty> : rows.length ? (
        <div className="grid grid-2">
          {rows.map((t: any) => (
            <section key={t.position_id} className="card row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
              <div style={{ width: 150, flexShrink: 0 }}><Board fen={t.fen} id={`t${t.position_id}`} /></div>
              <div className="stack" style={{ gap: 6, minWidth: 0 }}>
                <div><Link href={`/positions/${t.position_id}`}><b>Position #{t.position_id}</b></Link> <span className="muted small">{t.fen.split(" ")[1] === "w" ? "White" : "Black"} to move</span></div>
                <div className="small">{t.routes} incoming routes · {t.games} game(s)</div>
                <div className="small stack" style={{ gap: 2 }}>
                  {t.incoming.map((i: any) => (
                    <span key={`${i.from_position_id}-${i.san}`}>from <Link href={`/positions/${i.from_position_id}`}>#{i.from_position_id}</Link> by <span className="san">{i.san}</span> <span className="muted">×{i.games}</span></span>
                  ))}
                </div>
                <Link className="small" href={`/positions/${t.position_id}`}>See all move orders →</Link>
              </div>
            </section>
          ))}
        </div>
      ) : <Empty>No transpositions yet.</Empty>}
      {rows && <Pager base="/transpositions" params={{}} offset={offset} limit={LIMIT} count={rows.length} />}
    </>
  );
}
