import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { body, errorResponse, json, pagination } from "@/lib/http";
import { tournamentSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const { limit, offset } = pagination(request);
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    // Tournament cards: size, strength and decisiveness per event (aggregates over its games).
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT t.*, COUNT(g.game_id) AS games,
              (SELECT COUNT(DISTINCT v.player_id) FROM v_player_game v WHERE v.tournament_id = t.tournament_id) AS players,
              ROUND(AVG((g.white_elo + g.black_elo) / 2)) AS avg_elo,
              ROUND(100 * SUM(g.result IN ('1-0', '0-1')) / NULLIF(COUNT(g.game_id), 0)) AS decisive_pct,
              COUNT(*) OVER () AS total_rows
       FROM tournament t LEFT JOIN game g ON g.tournament_id = t.tournament_id
       GROUP BY t.tournament_id
       ORDER BY t.date IS NULL, t.date DESC, t.tournament_id DESC LIMIT ? OFFSET ?`, [String(limit), String(offset)],
    );
    await connection.commit();
    return json(rows);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
export async function POST(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const t = { date: null, location: null, ...tournamentSchema.parse(await body(request)) };
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [result] = await connection.execute<ResultSetHeader>("INSERT INTO tournament (name, date, location) VALUES (?, ?, ?)", [t.name, t.date, t.location]);
    await connection.commit();
    return json({ tournament_id: result.insertId, ...t }, 201);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
