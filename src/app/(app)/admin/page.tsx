import Link from "next/link";
import { apiGet, currentUser } from "@/lib/web/api";
import { ActionForm } from "@/components/ActionForm";
import { graphSync } from "@/app/actions";
import { Db, Empty, PageHead, Pager, Stat } from "@/components/ui";

export const metadata = { title: "Admin · Chess State Explorer" };
const LIMIT = 25;

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ offset?: string }> }) {
  const offset = Math.max(0, Number((await searchParams).offset) || 0);
  const [user, stats, audit] = await Promise.all([
    currentUser(),
    apiGet("/graph/stats").catch(() => null),
    apiGet(`/evaluations/audit?limit=${LIMIT}&offset=${offset}`),
  ]);
  const admin = user.role === "admin";
  return (
    <>
      <PageHead title={admin ? "Admin & audit" : "Audit log"} sub="Graph synchronisation status and the trigger-written evaluation audit trail." />
      <section className="card" style={{ marginBottom: 16 }}>
        <h2>MySQL → Neo4j synchronisation</h2>
        {stats ? (
          <div className="stats">
            <Stat label="Pending outbox changes" value={stats.mysql.pending_changes} note={stats.mysql.last_synced_at ? `last applied ${stats.mysql.last_synced_at} UTC` : "never synced"} />
            <Stat label="Move edges" value={`${stats.graph.edges} / ${stats.mysql.move_edges}`} note="Neo4j / MySQL v_move_edge" />
            <Stat label="Position nodes" value={stats.graph.nodes} note={`${stats.mysql.positions} rows in MySQL`} />
            <Stat label="Transpositions" value={stats.graph.transpositions} note={`${stats.graph.branch_points} branch points`} />
          </div>
        ) : <p className="callout callout-warn">Neo4j is unreachable. Game imports still commit; their changes wait in <code>graph_outbox</code> until the next sync.</p>}
        <p className="small muted">
          Triggers <code>trg_game_graph_insert</code>/<code>trg_game_graph_delete</code> write an outbox row inside the game&apos;s own transaction.
          The relay locks pending rows (<code>FOR UPDATE SKIP LOCKED</code>), recomputes each affected edge from the <code>v_move_edge</code> view, writes Neo4j, then marks the rows processed.
          Replaying is harmless (idempotent), so a crash between the two commits cannot corrupt the graph.
        </p>
        {admin ? (
          <div className="row">
            <ActionForm inline action={graphSync.bind(null, "drain")} submit="Apply pending changes" />
            <ActionForm inline action={graphSync.bind(null, "rebuild")} submit="Rebuild graph from MySQL" variant="ghost" confirm="Wipe and rebuild the whole Neo4j graph from MySQL?" />
          </div>
        ) : <p className="muted small">Only admins can trigger synchronisation.</p>}
      </section>
      <section className="card">
        <h2>Evaluation audit <Db kind="MySQL" /></h2>
        <p className="muted small" style={{ marginTop: -6 }}>Written by <code>trg_evaluation_insert</code> / <code>trg_evaluation_delete</code> as JSON snapshots. No FK to <code>evaluation</code>, so deleting a score cannot erase its history. Newest first.</p>
        {audit.length ? (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>#</th><th>Action</th><th>Evaluation</th><th>Position</th><th className="num">CP</th><th className="num">Depth</th><th>At (UTC)</th></tr></thead>
            <tbody>{audit.map((a: any) => {
              const s = typeof a.snapshot === "string" ? JSON.parse(a.snapshot) : a.snapshot;
              return (
                <tr key={a.audit_id}>
                  <td>{a.audit_id}</td>
                  <td><span className={`badge ${a.action === "DELETE" ? "" : "badge-admin"}`}>{a.action}</span></td>
                  <td>{a.evaluation_id}</td>
                  <td><Link href={`/positions/${s.position_id}`}>#{s.position_id}</Link></td>
                  <td className="num">{s.cp ?? "null"}</td><td className="num">{s.depth}</td>
                  <td className="small">{a.changed_at}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <Empty>No audit entries.</Empty>}
        <Pager base="/admin" params={{}} offset={offset} limit={LIMIT} count={audit.length} />
      </section>
    </>
  );
}
