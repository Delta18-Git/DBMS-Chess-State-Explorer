import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dashboard aggregates in one repeatable-read snapshot: table sizes, evaluation coverage,
// result distribution and an accuracy leaderboard (JOIN + GROUP BY + HAVING over the view).
export async function GET(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [[counts]] = await connection.query<RowDataPacket[]>(
      `SELECT (SELECT COUNT(*) FROM game) AS games, (SELECT COUNT(*) FROM ply) AS plies,
              (SELECT COUNT(*) FROM player) AS players, (SELECT COUNT(*) FROM opening) AS openings,
              (SELECT COUNT(*) FROM tournament) AS tournaments, (SELECT COUNT(*) FROM \`position\`) AS positions,
              (SELECT COUNT(*) FROM evaluation) AS evaluations,
              (SELECT COUNT(DISTINCT position_id) FROM evaluation) AS evaluated_positions,
              (SELECT COUNT(*) FROM repertoire) AS repertoires`,
    );
    const [results] = await connection.query<RowDataPacket[]>(
      "SELECT result, COUNT(*) AS games FROM game GROUP BY result ORDER BY games DESC",
    );
    // Evaluation coverage: share of plies whose centipawn loss is computable (both boards scored).
    const [[coverage]] = await connection.query<RowDataPacket[]>(
      `SELECT ROUND(100 * SUM(cp_loss IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS evaluated_ply_pct,
              ROUND(AVG(cp_loss), 1) AS avg_cp_loss, SUM(cp_loss >= 200) AS blunders
       FROM v_ply_analysis`,
    );
    const [accuracy] = await connection.query<RowDataPacket[]>(
      `SELECT pl.player_id, pl.name, pl.title, pl.rating, pl.federation, pl.photo_url,
              COUNT(DISTINCT a.game_id) AS games, COUNT(a.cp_loss) AS evaluated_moves,
              ROUND(AVG(a.cp_loss), 1) AS avg_cp_loss, SUM(a.cp_loss >= 200) AS blunders
       FROM v_ply_analysis a JOIN player pl ON pl.player_id = a.player_id
       GROUP BY pl.player_id, pl.name, pl.title, pl.rating, pl.federation, pl.photo_url
       HAVING COUNT(a.cp_loss) >= 20
       ORDER BY avg_cp_loss ASC, evaluated_moves DESC LIMIT 8`,
    );
    // Window function over a grouped derived table: rank boards (after move 3) by distinct games.
    const [hot] = await connection.query<RowDataPacket[]>(
      `SELECT position_id, fen, games FROM (
         SELECT p.position_id, p.fen, COUNT(DISTINCT m.game_id) AS games,
                RANK() OVER (ORDER BY COUNT(DISTINCT m.game_id) DESC) AS rnk
         FROM ply m JOIN \`position\` p ON p.position_id = m.to_position_id
         WHERE m.ply_no >= 6
         GROUP BY p.position_id, p.fen
         HAVING COUNT(DISTINCT m.game_id) >= 2
       ) ranked WHERE rnk <= 5 ORDER BY games DESC, position_id LIMIT 5`,
    );
    await connection.commit();
    return json({ counts, results, coverage, accuracy, popular_positions: hot });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
