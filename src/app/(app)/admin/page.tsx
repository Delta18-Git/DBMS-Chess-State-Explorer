import Link from "next/link";
import { redirect } from "next/navigation";
import { apiGet, currentUser } from "@/lib/web/api";
import { ActionForm, Field } from "@/components/ActionForm";
import { PasswordInput } from "@/components/PasswordInput";
import { Tabs } from "@/components/Tabs";
import { analyse, createUser, deleteUser, graphSync, importLichess } from "@/app/actions";
import { AdminBar, Card, Empty, PageHead, Pagination, Stat, Stats, pageOf, pawns } from "@/components/ui";

export const metadata = { title: "Admin · Chess State Explorer" };
const PER_PAGE = 20;

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ page?: string; tab?: string }> }) {
  const user = await currentUser();
  if (user.role !== "admin") redirect("/");
  const sp = await searchParams;
  const page = pageOf(sp);
  const [stats, overview, users, audit] = await Promise.all([
    apiGet("/graph/stats").catch(() => null),
    apiGet("/analytics/overview"),
    apiGet("/users"),
    apiGet(`/evaluations/audit?limit=${PER_PAGE}&offset=${(page - 1) * PER_PAGE}`),
  ]);
  const c = overview.counts;
  const unscored = Number(c.positions) - Number(c.evaluated_positions);

  return (
    <>
      <PageHead title="Admin" lead="Keep the shared database current: import tournaments, score positions, sync the graph and manage accounts." />
      <AdminBar hint="Analysts can read everything and manage their own repertoires; only admins change shared data.">
        <span className="small">Signed in as <b>{user.display_name ?? user.email}</b></span>
      </AdminBar>

      <section className="card">
        <Tabs initial={sp.tab} tabs={[
          { id: "import", label: "Import tournaments", content: <div className="card-body" style={{ maxWidth: 640 }}>
            <p className="small ink-2" style={{ marginBottom: 12 }}>From the Lichess broadcast API; players are enriched from Lichess&apos;s FIDE API and photos come from Wikimedia Commons.</p>
          <ActionForm action={importLichess.bind(null, true)} submit="Import from Lichess" icon="upload">
            <Field label="Broadcast link or id" hint="e.g. https://lichess.org/broadcast/…/3COxSfdj"><input name="source" required placeholder="https://lichess.org/broadcast/…" /></Field>
          </ActionForm>
          </div> },
          { id: "engine", label: "Stockfish", content: <div className="card-body" style={{ maxWidth: 640 }}>
            <p className="small ink-2" style={{ marginBottom: 12 }}>{Number(c.evaluated_positions).toLocaleString("en")} of {Number(c.positions).toLocaleString("en")} boards scored.</p>
          <ActionForm action={analyse.bind(null, {})} submit="Score boards from new games" icon="cpu">
            <p className="small ink-2">Scores every board reached in a stored game that has no evaluation yet (2,000 per run), e.g. after importing a tournament. {unscored > 0 ? `The other ${unscored.toLocaleString("en")} boards only name opening-catalogue lines and are not scored.` : ""} Stockfish 19 runs on the server; each score is audited by a trigger.</p>
            <Field label="Depth"><select name="depth" defaultValue="14" style={{ maxWidth: 220 }}><option value="12">12 (fast)</option><option value="14">14</option><option value="18">18 (slow)</option></select></Field>
          </ActionForm>
          </div> },
          { id: "graph", label: "Graph sync", content: <>
            <div className="card-body small ink-2" style={{ paddingBottom: 0 }}>Game inserts and deletes queue a row in <code>graph_outbox</code> (trigger, same transaction); the relay applies them to Neo4j idempotently.</div>
          {stats ? (
            <Stats>
              <Stat label="Pending changes" value={stats.mysql.pending_changes} note={stats.mysql.last_synced_at ? `last ${stats.mysql.last_synced_at.slice(0, 16)} UTC` : "never synced"} />
              <Stat label="Move edges" value={Number(stats.graph.edges).toLocaleString("en")} note={`MySQL view: ${Number(stats.mysql.move_edges).toLocaleString("en")}`} />
              <Stat label="Transpositions" value={stats.graph.transpositions} />
            </Stats>
          ) : <div className="card-body"><p className="note note-warn">Neo4j is unreachable. Imports still commit; changes wait in the outbox.</p></div>}
          <div className="card-body row">
            <ActionForm inline action={graphSync.bind(null, "drain")} submit="Apply pending changes" small />
            <ActionForm inline action={graphSync.bind(null, "rebuild")} submit="Rebuild graph" variant="ghost" small confirm="Wipe and rebuild the whole Neo4j graph from MySQL?" />
          </div>
          </> },
          { id: "accounts", label: "Accounts", count: users.length, content: <>
          <table className="t compact"><tbody>{users.map((u: any) => (
            <tr key={u.user_id}>
              <td><div style={{ fontWeight: 500 }}>{u.display_name ?? "—"}</div><div className="tiny muted">{u.email}</div></td>
              <td><span className={`chip ${u.role === "admin" ? "chip-accent" : ""}`}>{u.role}</span>{Number(u.locked) === 1 && <span className="chip chip-bad" style={{ marginLeft: 4 }}>locked</span>}</td>
              <td className="num small muted">{u.repertoires} rep.</td>
              <td className="num">{u.user_id !== user.user_id && <ActionForm inline action={deleteUser.bind(null, u.user_id)} submit="Remove" variant="ghost" small confirm={`Delete ${u.email}? Their repertoires are kept.`} />}</td>
            </tr>
          ))}</tbody></table>
          <details className="card-foot">
            <summary style={{ cursor: "pointer", fontWeight: 500 }}>Add an account</summary>
            <div style={{ marginTop: 12 }}>
              <ActionForm action={createUser} submit="Create account" resetOnSuccess>
                <div className="form-row">
                  <Field label="Name"><input name="display_name" required maxLength={100} /></Field>
                  <Field label="Email"><input name="email" type="email" required maxLength={254} /></Field>
                </div>
                <div className="form-row">
                  <Field label="Role"><select name="role" defaultValue="analyst"><option value="analyst">Analyst</option><option value="admin">Admin</option></select></Field>
                  <Field label="Password" hint="12+ characters"><PasswordInput name="password" required minLength={12} maxLength={256} autoComplete="new-password" /></Field>
                </div>
              </ActionForm>
            </div>
          </details>
          </> },
          { id: "audit", label: "Evaluation audit log", content: <>
            <div className="card-body small ink-2" style={{ paddingBottom: 0 }}>Written by triggers on every evaluation insert/delete as a JSON snapshot; survives the deletion of the evaluation itself.</div>
        {audit.length ? (
          <div className="table-wrap"><table className="t compact">
            <thead><tr><th>#</th><th>Action</th><th>Position</th><th className="num">Score</th><th>Best</th><th className="num">Depth</th><th className="num">When (UTC)</th></tr></thead>
            <tbody>{audit.map((a: any) => {
              const s = typeof a.snapshot === "string" ? JSON.parse(a.snapshot) : a.snapshot;
              return (
                <tr key={a.audit_id}>
                  <td className="muted small">{a.audit_id}</td>
                  <td><span className={`chip ${a.action === "DELETE" ? "chip-bad" : "chip-good"}`}>{a.action}</span></td>
                  <td><Link href={`/positions/${s.position_id}`}>#{s.position_id}</Link></td>
                  <td className="num mono small">{pawns(s.cp, s.mate)}</td>
                  <td className="mono small">{s.best_move ?? "—"}</td>
                  <td className="num">{s.depth}</td>
                  <td className="num small muted">{String(a.changed_at).slice(0, 16)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <Empty>No audit entries.</Empty>}
        <Pagination base="/admin" params={{ tab: "audit" }} page={page} perPage={PER_PAGE} total={Number(audit[0]?.total_rows ?? 0)} />
          </> },
        ]} />
      </section>
    </>
  );
}
