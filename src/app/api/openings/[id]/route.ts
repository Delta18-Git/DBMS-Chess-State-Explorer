import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { body, errorResponse, found, id, json, type IdContext } from "@/lib/http";
import { openingSchema } from "@/lib/validation";
import type { OpeningRow } from "@/lib/rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const openingId = id.parse((await context.params).id);
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT * FROM opening WHERE opening_id = ?", [openingId]);
    const opening = found(rows);
    const [[stats]] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS games, SUM(result = '1-0') AS white_wins, SUM(result = '1/2-1/2') AS draws,
              SUM(result = '0-1') AS black_wins, ROUND(AVG((white_elo + black_elo) / 2)) AS avg_elo,
              MIN(date) AS first_played, MAX(date) AS last_played
       FROM game WHERE opening_id = ?`, [openingId],
    );
    // Who plays it, and how well (per colour), from the per-player game view.
    const [players] = await connection.execute<RowDataPacket[]>(
      `SELECT v.player_id, p.name, p.title, p.federation, p.photo_url, v.color, COUNT(*) AS games,
              SUM(v.score) AS points, ROUND(100 * AVG(v.score)) AS score_pct
       FROM v_player_game v JOIN player p ON p.player_id = v.player_id
       WHERE v.opening_id = ? AND v.result <> '*'
       GROUP BY v.player_id, p.name, p.title, p.federation, p.photo_url, v.color
       ORDER BY games DESC, score_pct DESC LIMIT 12`, [openingId],
    );
    // The board that defines the opening: its catalogue position, else the deepest board that every
    // game classified under it passed through (longest common prefix via GROUP BY ply_no HAVING).
    let positionId = opening.position_id === null ? null : Number(opening.position_id);
    if (positionId === null && Number(stats.games) > 0) {
      const [prefix] = await connection.execute<RowDataPacket[]>(
        `SELECT m.ply_no, MIN(m.to_position_id) AS position_id FROM ply m JOIN game g ON g.game_id = m.game_id
         WHERE g.opening_id = ? GROUP BY m.ply_no
         HAVING COUNT(DISTINCT m.to_position_id) = 1 AND COUNT(*) = ? ORDER BY m.ply_no`, [openingId, stats.games],
      );
      for (let i = 0; i < prefix.length && Number(prefix[i].ply_no) === i + 1; i++) positionId = Number(prefix[i].position_id);
    }
    const [positions] = positionId === null ? [[]] : await connection.execute<RowDataPacket[]>("SELECT position_id, fen FROM `position` WHERE position_id = ?", [positionId]);
    await connection.commit();
    return json({ ...opening, stats, players, position: positions[0] ?? null });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
export async function PATCH(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const openingId = id.parse((await context.params).id);
    const patch = openingSchema.partial().refine(v => Object.keys(v).length > 0).parse(await body(request));
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [rows] = await connection.execute<OpeningRow[]>("SELECT * FROM opening WHERE opening_id = ? FOR UPDATE", [openingId]);
    const o = { ...found(rows), ...patch };
    await connection.execute("UPDATE opening SET eco = ?, name = ? WHERE opening_id = ?", [o.eco, o.name, openingId]);
    await connection.commit();
    return json(o);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
export async function DELETE(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const openingId = id.parse((await context.params).id);
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT opening_id FROM opening WHERE opening_id = ? FOR UPDATE", [openingId]);
    found(rows);
    await connection.execute("DELETE FROM opening WHERE opening_id = ?", [openingId]);
    await connection.commit();
    return json({ deleted: openingId });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
