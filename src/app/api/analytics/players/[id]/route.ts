import type { PoolConnection, ProcedureCallPacket, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { errorResponse, found, id, json, pagination, type IdContext } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const playerId = id.parse((await context.params).id);
    const { limit, offset } = pagination(request);
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [result] = await connection.query<ProcedureCallPacket<RowDataPacket[]>>("CALL sp_player_summary(?)", [playerId]);
    const summary = found(result[0]);
    const [blunders] = await connection.execute<RowDataPacket[]>(
      `SELECT a.game_id, a.ply_no, a.side, a.move_san, a.before_cp, a.after_cp, a.cp_loss, e.best_move_san,
              opp.name AS opponent_name, g.date
       FROM v_ply_analysis a JOIN ply m ON m.ply_id = a.ply_id JOIN game g ON g.game_id = a.game_id
       JOIN player opp ON opp.player_id = IF(a.side = 'w', g.black_player_id, g.white_player_id)
       LEFT JOIN v_latest_evaluation e ON e.position_id = m.from_position_id
       WHERE a.player_id = ? AND a.cp_loss >= 200 ORDER BY a.cp_loss DESC, a.game_id, a.ply_no LIMIT ? OFFSET ?`,
      [playerId, String(limit), String(offset)],
    );
    const [byColor] = await connection.execute<RowDataPacket[]>(
      `SELECT color, COUNT(*) AS games, SUM(score = 1) AS wins, SUM(score = 0.5) AS draws, SUM(score = 0) AS losses,
              ROUND(100 * AVG(score)) AS score_pct, ROUND(AVG(opponent_elo)) AS avg_opponent_elo
       FROM v_player_game WHERE player_id = ? AND result <> '*' GROUP BY color ORDER BY color DESC`, [playerId],
    );
    // Opening repertoire per colour: what they play and how it goes (JOIN + GROUP BY over the view).
    const [openings] = await connection.execute<RowDataPacket[]>(
      `SELECT v.color, o.opening_id, o.eco, o.name, COUNT(*) AS games, ROUND(100 * AVG(v.score)) AS score_pct,
              SUM(v.score = 1) AS wins, SUM(v.score = 0.5) AS draws, SUM(v.score = 0) AS losses
       FROM v_player_game v JOIN opening o ON o.opening_id = v.opening_id
       WHERE v.player_id = ? AND v.result <> '*'
       GROUP BY v.color, o.opening_id, o.eco, o.name ORDER BY v.color DESC, games DESC, o.eco`, [playerId],
    );
    // First move as White, and the reply as Black to each of White's first moves.
    const [firstMoves] = await connection.execute<RowDataPacket[]>(
      `SELECT v.color, w1.move_san AS first_move, IF(v.color = 'b', b1.move_san, NULL) AS reply, COUNT(*) AS games,
              ROUND(100 * AVG(v.score)) AS score_pct
       FROM v_player_game v
       JOIN ply w1 ON w1.game_id = v.game_id AND w1.ply_no = 1
       LEFT JOIN ply b1 ON b1.game_id = v.game_id AND b1.ply_no = 2
       WHERE v.player_id = ? AND v.result <> '*'
       GROUP BY v.color, first_move, reply ORDER BY v.color DESC, games DESC`, [playerId],
    );
    const [accuracy] = await connection.execute<RowDataPacket[]>(
      `SELECT a.game_id, g.date, ROUND(AVG(a.cp_loss), 1) AS avg_cp_loss, COUNT(a.cp_loss) AS moves,
              SUM(a.cp_loss >= 200) AS blunders, v.score, v.color
       FROM v_ply_analysis a JOIN game g ON g.game_id = a.game_id
       JOIN v_player_game v ON v.game_id = a.game_id AND v.player_id = a.player_id
       WHERE a.player_id = ? GROUP BY a.game_id, g.date, v.score, v.color
       HAVING COUNT(a.cp_loss) > 0 ORDER BY g.date, a.game_id`, [playerId],
    );
    await connection.commit();
    return json({ summary, blunders, by_color: byColor, openings, first_moves: firstMoves, accuracy });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
