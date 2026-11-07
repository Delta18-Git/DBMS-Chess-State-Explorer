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
    // One-step explorer: every move played from this board, its results, the Stockfish score of the
    // board it leads to, and the strength of the players who chose it.
    const [moves] = await connection.execute<RowDataPacket[]>(
      `SELECT p.move_san, p.to_position_id, t.fen AS to_fen, COUNT(*) AS occurrences,
              COUNT(DISTINCT p.game_id) AS games, COUNT(DISTINCT CASE WHEN g.result <> '*' THEN g.game_id END) AS completed_games,
              COUNT(DISTINCT CASE WHEN g.result = '1-0' THEN g.game_id END) AS white_wins,
              COUNT(DISTINCT CASE WHEN g.result = '0-1' THEN g.game_id END) AS black_wins,
              COUNT(DISTINCT CASE WHEN g.result = '1/2-1/2' THEN g.game_id END) AS draws,
              ROUND(AVG(IF(p.side = 'w', g.white_elo, g.black_elo))) AS avg_elo, MAX(g.date) AS last_played,
              MAX(e.cp) AS cp, MAX(e.mate) AS mate, MAX(e.depth) AS depth,
              (SELECT o.name FROM opening o WHERE o.position_id = p.to_position_id ORDER BY o.opening_id LIMIT 1) AS opening_name
       FROM ply p JOIN game g ON g.game_id = p.game_id JOIN \`position\` t ON t.position_id = p.to_position_id
       LEFT JOIN v_latest_evaluation e ON e.position_id = p.to_position_id
       WHERE p.from_position_id = ? GROUP BY p.move_san, p.to_position_id, t.fen
       ORDER BY games DESC, p.move_san LIMIT ? OFFSET ?`, [positionId, String(limit), String(offset)],
    );
    const [games] = await connection.execute<RowDataPacket[]>(
      `SELECT g.game_id, g.date, g.result, g.round, w.name AS white_name, w.title AS white_title, g.white_elo,
              b.name AS black_name, b.title AS black_title, g.black_elo, t.name AS tournament_name, MIN(m.ply_no) AS ply_no
       FROM ply m JOIN game g ON g.game_id = m.game_id
       JOIN player w ON w.player_id = g.white_player_id JOIN player b ON b.player_id = g.black_player_id
       LEFT JOIN tournament t ON t.tournament_id = g.tournament_id
       WHERE m.to_position_id = ?
       GROUP BY g.game_id, g.date, g.result, g.round, w.name, w.title, g.white_elo, b.name, b.title, g.black_elo, t.name
       ORDER BY (COALESCE(g.white_elo, 0) + COALESCE(g.black_elo, 0)) DESC, g.date DESC LIMIT 12`, [positionId],
    );
    const [named] = await connection.execute<RowDataPacket[]>(
      "SELECT opening_id, eco, name FROM opening WHERE position_id = ? ORDER BY opening_id LIMIT 1", [positionId],
    );
    await connection.commit();
    return json({ position, usage: usage[0], next_moves: moves, games, opening: named[0] ?? null });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
