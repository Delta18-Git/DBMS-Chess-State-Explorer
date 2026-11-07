"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Chess } from "chess.js";
import { ApiFailure, SESSION_COOKIE, apiGet, apiPublic, apiSend } from "@/lib/web/api";

// Every mutation is a Server Action (Next.js checks Origin against Host: CSRF protection) that
// forwards to the /api handlers, which re-validate input and enforce the admin role themselves.
// Hiding admin buttons from analysts is only a convenience; the API is the real gate.

export type FormState = { ok?: string; error?: string } | undefined;

const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const num = (fd: FormData, k: string) => {
  const v = text(fd, k);
  return v === null ? null : Number(v);
};
const fail = (e: unknown): FormState => {
  if (e instanceof ApiFailure) return { error: e.status === 403 ? (e.message.includes("owner") ? e.message : "This needs the admin role.") : e.message };
  throw e; // redirects and unexpected errors propagate
};
async function run(work: () => Promise<string | void>, paths: string[] = ["/"]): Promise<FormState> {
  try {
    const ok = await work();
    for (const p of paths) revalidatePath(p, "layout");
    return { ok: ok || "Saved" };
  } catch (e) { return fail(e); }
}
/** Best-effort outbox drain after game writes; the outbox keeps the change if Neo4j is down. */
async function syncGraph() {
  try { await apiSend("/graph/sync", "POST"); return ""; } catch { return " (graph sync pending: Neo4j unavailable)"; }
}

// ---------- auth ----------
export async function login(_: FormState, fd: FormData): Promise<FormState> {
  let session: { token: string; expires_in: number };
  try {
    session = await apiPublic("/auth/login", { email: text(fd, "email") ?? "", password: String(fd.get("password") ?? "") });
  } catch (e) {
    if (e instanceof ApiFailure) return { error: e.status === 429 ? "Account locked after repeated failures. Try again in 15 minutes." : e.status === 400 || e.status === 401 ? "Wrong email or password." : e.message };
    throw e;
  }
  (await cookies()).set(SESSION_COOKIE, session.token, {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: session.expires_in,
  });
  redirect("/");
}

export async function logout() {
  try { await apiSend("/auth/logout", "POST"); } catch { /* already expired */ }
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------- players / tournaments / openings ----------
const playerBody = (fd: FormData) => ({
  name: text(fd, "name"), title: text(fd, "title"), federation: text(fd, "federation")?.toUpperCase() ?? null,
  birth_year: num(fd, "birth_year"), rating: num(fd, "rating"),
});
export async function createPlayer(_: FormState, fd: FormData) {
  return run(async () => { const p = await apiSend("/players", "POST", playerBody(fd)); return `Created player #${p.player_id}`; }, ["/players"]);
}
export async function updatePlayer(id: number, _: FormState, fd: FormData) {
  return run(async () => { await apiSend(`/players/${id}`, "PATCH", playerBody(fd)); return "Player updated"; }, ["/players"]);
}
export async function deletePlayer(id: number, _: FormState) {
  const r = await run(async () => { await apiSend(`/players/${id}`, "DELETE"); });
  if (r?.error) return r;
  redirect("/players");
}

export async function createTournament(_: FormState, fd: FormData) {
  return run(async () => {
    const t = await apiSend("/tournaments", "POST", { name: text(fd, "name"), date: text(fd, "date"), location: text(fd, "location") });
    return `Created tournament #${t.tournament_id}`;
  }, ["/tournaments"]);
}
export async function deleteTournament(id: number, _: FormState): Promise<FormState> {
  try { await apiSend(`/tournaments/${id}`, "DELETE"); } catch (e) { return fail(e); }
  revalidatePath("/tournaments", "layout");
  redirect("/tournaments");
}

export async function createOpening(_: FormState, fd: FormData) {
  return run(async () => {
    const o = await apiSend("/openings", "POST", { eco: text(fd, "eco")?.toUpperCase() ?? "", name: text(fd, "name") });
    return `Created opening #${o.opening_id}`;
  }, ["/openings"]);
}
export async function deleteOpening(id: number, _: FormState) {
  return run(async () => { await apiSend(`/openings/${id}`, "DELETE"); return "Opening deleted"; }, ["/openings"]);
}

// ---------- import & engine ----------
export async function importPgn(_: FormState, fd: FormData): Promise<FormState> {
  let r: { imported: number; duplicates: number; failed: { error: string }[]; game_ids: number[] };
  try { r = await apiSend("/import/pgn", "POST", { pgn: String(fd.get("pgn") ?? ""), tournament_id: num(fd, "tournament_id") }); }
  catch (e) { return fail(e); }
  const note = await syncGraph();
  revalidatePath("/", "layout");
  if (r.imported === 1) redirect(`/games/${r.game_ids[0]}?imported=1`);
  return { ok: `Imported ${r.imported} game(s)${r.duplicates ? `, ${r.duplicates} already stored` : ""}${r.failed.length ? `, ${r.failed.length} rejected (${r.failed[0].error})` : ""}${note}` };
}
export async function importLichess(live: boolean, _: FormState, fd: FormData): Promise<FormState> {
  let r: { tournament: string; tournament_id: number; imported: number; duplicates: number; failed: unknown[] };
  try { r = await apiSend("/import/lichess", "POST", { source: text(fd, "source") ?? "", live }); }
  catch (e) { return fail(e); }
  const note = await syncGraph();
  revalidatePath("/", "layout");
  return { ok: `${r.tournament}: ${r.imported} new game(s)${r.duplicates ? `, ${r.duplicates} already stored` : ""}${note}. Run Stockfish on it to score the moves.` };
}
export async function analyse(target: { game_id?: number; tournament_id?: number; position_id?: number }, _: FormState, fd?: FormData) {
  return run(async () => {
    const depth = fd ? num(fd, "depth") : null;
    const r = await apiSend("/engine/analyse", "POST", { ...target, depth: depth ?? (target.position_id ? 20 : 14), limit: 2000 });
    return r.scored ? `Stockfish scored ${r.scored} position(s) at depth ${r.depth}${r.remaining ? " (more remain: run again)" : ""}` : "Every position here already has an evaluation at that depth";
  });
}

// ---------- games ----------
export async function updateGame(id: number, _: FormState, fd: FormData) {
  return run(async () => {
    await apiSend(`/games/${id}`, "PATCH", { tournament_id: num(fd, "tournament_id"), opening_id: num(fd, "opening_id"), date: text(fd, "date") });
    return "Game metadata updated";
  }, [`/games/${id}`]);
}
export async function deleteGame(id: number, _: FormState): Promise<FormState> {
  try { await apiSend(`/games/${id}`, "DELETE"); } catch (e) { return fail(e); }
  await syncGraph();
  revalidatePath("/", "layout");
  redirect("/games?deleted=1");
}

// ---------- positions & evaluations ----------
export async function updatePositionComment(id: number, _: FormState, fd: FormData) {
  return run(async () => { await apiSend(`/positions/${id}`, "PATCH", { comment: text(fd, "comment") }); return "Comment saved"; }, [`/positions/${id}`]);
}
export async function addEvaluation(positionId: number, _: FormState, fd: FormData) {
  return run(async () => {
    const raw = text(fd, "cp");
    await apiSend("/evaluations", "POST", { position_id: positionId, cp: raw === null ? null : Number(raw), depth: num(fd, "depth") });
    return "Evaluation stored (audit trigger fired)";
  }, [`/positions/${positionId}`, "/admin"]);
}
export async function deleteEvaluation(id: number, positionId: number, _: FormState) {
  return run(async () => { await apiSend(`/evaluations/${id}`, "DELETE"); return "Evaluation deleted (snapshot kept in audit)"; }, [`/positions/${positionId}`, "/admin"]);
}

// ---------- repertoires ----------
export async function createRepertoire(_: FormState, fd: FormData): Promise<FormState> {
  let id: number;
  try {
    id = (await apiSend("/repertoires", "POST", { player_id: num(fd, "player_id"), name: text(fd, "name"), color: text(fd, "color") ?? "w" })).repertoire_id;
    if (fd.get("build") === "on") await apiSend(`/repertoires/${id}/build`, "POST", { moves: num(fd, "moves") ?? 10, min_games: 1 });
  } catch (e) { return fail(e); }
  revalidatePath("/repertoires", "layout");
  redirect(`/repertoires/${id}`);
}
export async function deleteRepertoire(id: number, _: FormState): Promise<FormState> {
  try { await apiSend(`/repertoires/${id}`, "DELETE"); } catch (e) { return fail(e); }
  revalidatePath("/repertoires", "layout");
  redirect("/repertoires");
}
export async function addLine(repertoireId: number, _: FormState, fd: FormData) {
  return run(async () => {
    // The position is given as the moves that lead to it; it must already be a stored board.
    const board = new Chess();
    try { for (const t of (text(fd, "moves") ?? "").split(/\s+/).map(t => t.replace(/^\d+\.(\.\.)?/, "")).filter(Boolean)) board.move(t); }
    catch { throw new ApiFailure(400, "Those moves are not legal from the starting position"); }
    const fen = board.fen().split(" ").slice(0, 4).join(" ") + " 0 1";
    const found = await apiGet<{ position_id: number }[]>(`/positions?fen=${encodeURIComponent(fen)}`);
    if (!found.length) throw new ApiFailure(404, "No stored game reaches that position");
    await apiSend(`/repertoires/${repertoireId}/lines`, "POST", { start_position_id: found[0].position_id, move_san: text(fd, "move_san") });
    return "Recommended move added";
  }, [`/repertoires/${repertoireId}`]);
}
export async function buildRepertoire(repertoireId: number, _: FormState, fd: FormData) {
  return run(async () => {
    const r = await apiSend(`/repertoires/${repertoireId}/build`, "POST", { moves: num(fd, "moves") ?? 10, min_games: num(fd, "min_games") ?? 1 });
    return r.added ? `Added ${r.added} prepared move(s) from the player's games` : "Nothing new to add";
  }, [`/repertoires/${repertoireId}`]);
}
export async function addLineFromPosition(repertoireId: number, positionId: number, san: string, _: FormState) {
  return run(async () => { await apiSend(`/repertoires/${repertoireId}/lines`, "POST", { start_position_id: positionId, move_san: san }); return `Saved ${san}`; }, [`/repertoires/${repertoireId}`, `/positions/${positionId}`]);
}
export async function deleteLine(repertoireId: number, lineId: number, _: FormState) {
  return run(async () => { await apiSend(`/repertoires/${repertoireId}/lines/${lineId}`, "DELETE"); return "Line removed"; }, [`/repertoires/${repertoireId}`]);
}

// ---------- accounts ----------
export async function createUser(_: FormState, fd: FormData) {
  return run(async () => {
    await apiSend("/users", "POST", { email: text(fd, "email") ?? "", display_name: text(fd, "display_name") ?? "", role: text(fd, "role") ?? "analyst", password: String(fd.get("password") ?? "") });
    return "Account created";
  }, ["/admin"]);
}
export async function deleteUser(id: number, _: FormState) {
  return run(async () => { await apiSend(`/users/${id}`, "DELETE"); return "Account deleted"; }, ["/admin"]);
}
export async function updateTournament(id: number, _: FormState, fd: FormData) {
  return run(async () => {
    await apiSend(`/tournaments/${id}`, "PATCH", { name: text(fd, "name"), date: text(fd, "date"), location: text(fd, "location") });
    return "Tournament updated";
  }, [`/tournaments/${id}`]);
}

// ---------- graph ----------
export async function graphSync(mode: "drain" | "rebuild", _: FormState) {
  return run(async () => {
    const r = await apiSend(`/graph/sync?mode=${mode}`, "POST");
    return mode === "rebuild"
      ? `Graph rebuilt from MySQL: ${r.edges} move edges (${r.outbox_cleared} pending changes absorbed)`
      : r.processed ? `Applied ${r.processed} outbox change(s): ${r.edges_upserted} edges upserted, ${r.edges_removed} removed` : "Graph already up to date";
  });
}
