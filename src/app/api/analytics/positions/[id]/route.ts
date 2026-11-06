import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { errorResponse, found, id, json, pagination, type IdContext } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const positionId = id.parse((await context.params).id);
    const { limit, offset } = pagination(request);
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [positions] = await connection.execute<RowDataPacket[]>("SELECT * FROM `position` WHERE position_id = ?", [positionId]);
    const position = found(positions);
    const [usage] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT game_id) AS games, COUNT(*) AS occurrences FROM (
         SELECT game_id, ply_no FROM ply WHERE to_position_id = ?
         UNION ALL SELECT game_id, 0 AS ply_no FROM ply WHERE from_position_id = ? AND ply_no = 1
       ) visits`, [positionId, positionId],
    );
    // One-step SQL explorer only; arbitrary move-order/path traversal belongs to Neo4j in phase two.
    const [moves] = await connection.execute<RowDataPacket[]>(
      `SELECT p.move_san, p.to_position_id, t.fen AS to_fen, COUNT(*) AS occurrences,
              COUNT(DISTINCT p.game_id) AS games, COUNT(DISTINCT CASE WHEN g.result <> '*' THEN g.game_id END) AS completed_games,
              COUNT(DISTINCT CASE WHEN g.result = '1-0' THEN g.game_id END) AS white_wins,
              COUNT(DISTINCT CASE WHEN g.result = '0-1' THEN g.game_id END) AS black_wins,
              COUNT(DISTINCT CASE WHEN g.result = '1/2-1/2' THEN g.game_id END) AS draws
       FROM ply p JOIN game g ON g.game_id = p.game_id JOIN \`position\` t ON t.position_id = p.to_position_id
       WHERE p.from_position_id = ? GROUP BY p.move_san, p.to_position_id, t.fen
       ORDER BY games DESC, p.move_san LIMIT ? OFFSET ?`, [positionId, String(limit), String(offset)],
    );
    await connection.commit();
    return json({ position, usage: usage[0], next_moves: moves });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
