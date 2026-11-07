import { z } from "zod";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { ApiError, body, errorResponse, found, id, json, type IdContext } from "@/lib/http";
import { nodeFacts, readGraph } from "@/lib/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const canEdit = (user: { role: string; user_id: number }, rep: RowDataPacket) =>
  user.role === "admin" || (rep.owner_user_id !== null && Number(rep.owner_user_id) === Number(user.user_id));

// A repertoire with, per prepared move, how often the player followed it or deviated, plus the
// list of games where they deviated (JOIN of repertoire_line with the player's own plies).
export async function GET(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const repertoireId = id.parse((await context.params).id);
    await connection.query("START TRANSACTION READ ONLY");
    const user = await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT r.*, p.name AS player_name, p.title AS player_title, p.photo_url AS player_photo, u.display_name AS owner_name
       FROM repertoire r JOIN player p ON p.player_id = r.player_id LEFT JOIN app_user u ON u.user_id = r.owner_user_id
       WHERE r.repertoire_id = ?`, [repertoireId],
    );
    const repertoire = found(rows);
    const mine = `IF(r.color = 'w', g.white_player_id, g.black_player_id) = r.player_id`;
    const [lines] = await connection.execute<RowDataPacket[]>(
      `SELECT l.*, s.fen,
              COALESCE((SELECT MIN(m.ply_no) FROM ply m WHERE m.to_position_id = l.start_position_id), 0) AS reached_at_ply,
              (SELECT COUNT(*) FROM ply m JOIN game g ON g.game_id = m.game_id
                WHERE m.from_position_id = l.start_position_id AND m.move_san = l.move_san AND ${mine}) AS followed,
              (SELECT COUNT(*) FROM ply m JOIN game g ON g.game_id = m.game_id
                WHERE m.from_position_id = l.start_position_id AND m.move_san <> l.move_san AND ${mine}) AS deviated
       FROM repertoire_line l JOIN repertoire r ON r.repertoire_id = l.repertoire_id
       JOIN \`position\` s ON s.position_id = l.start_position_id
       WHERE l.repertoire_id = ? ORDER BY reached_at_ply, l.repertoire_line_id`, [repertoireId],
    );
    const [deviations] = await connection.execute<RowDataPacket[]>(
      `SELECT g.game_id, g.date, g.result, g.round, t.name AS tournament_name, m.ply_no, m.move_san AS played,
              l.move_san AS prepared, l.start_position_id, opp.player_id AS opponent_id, opp.name AS opponent_name,
              a.cp_loss
       FROM repertoire r
       JOIN repertoire_line l ON l.repertoire_id = r.repertoire_id
       JOIN ply m ON m.from_position_id = l.start_position_id AND m.side = r.color AND m.move_san <> l.move_san
       JOIN game g ON g.game_id = m.game_id AND ${mine}
       JOIN player opp ON opp.player_id = IF(r.color = 'w', g.black_player_id, g.white_player_id)
       LEFT JOIN tournament t ON t.tournament_id = g.tournament_id
       LEFT JOIN v_ply_analysis a ON a.ply_id = m.ply_id
       WHERE r.repertoire_id = ? ORDER BY g.date DESC, g.game_id DESC, m.ply_no LIMIT 100`, [repertoireId],
    );
    await connection.commit();
    // How each prepared position arises (a representative move order), from the graph; optional.
    const facts = await readGraph(tx => nodeFacts(tx, lines.map(l => Number(l.start_position_id)))).catch(() => []);
    const lineOf = new Map(facts.map(f => [Number(f.position_id), f]));
    const withLines = lines.map(l => ({ ...l, line: lineOf.get(Number(l.start_position_id))?.line ?? null, opening: lineOf.get(Number(l.start_position_id))?.opening ?? null }));
    return json({ ...repertoire, can_edit: canEdit(user, repertoire), lines: withLines, deviations });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
export async function PATCH(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const repertoireId = id.parse((await context.params).id);
    const input = z.object({ name: z.string().trim().min(1).max(100) }).strict().parse(await body(request));
    await connection.beginTransaction();
    const user = await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT * FROM repertoire WHERE repertoire_id = ? FOR UPDATE", [repertoireId]);
    const repertoire = found(rows);
    if (!canEdit(user, repertoire)) throw new ApiError(403, "Only the owner or an admin can change this repertoire");
    await connection.execute("UPDATE repertoire SET name = ? WHERE repertoire_id = ?", [input.name, repertoireId]);
    await connection.commit();
    return json({ ...repertoire, name: input.name });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
export async function DELETE(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const repertoireId = id.parse((await context.params).id);
    await connection.beginTransaction();
    const user = await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT * FROM repertoire WHERE repertoire_id = ? FOR UPDATE", [repertoireId]);
    if (!canEdit(user, found(rows))) throw new ApiError(403, "Only the owner or an admin can delete this repertoire");
    await connection.execute("DELETE FROM repertoire_line WHERE repertoire_id = ?", [repertoireId]);
    await connection.execute("DELETE FROM repertoire WHERE repertoire_id = ?", [repertoireId]);
    await connection.commit();
    return json({ deleted: repertoireId });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
