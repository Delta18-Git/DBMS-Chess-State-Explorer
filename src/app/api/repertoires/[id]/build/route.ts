import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { ApiError, body, errorResponse, found, id, json, type IdContext } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ moves: z.number().int().min(1).max(30).default(12), min_games: z.number().int().min(1).max(100).default(1) }).strict();

// Builds a repertoire from the player's own games in one INSERT … SELECT: at every board where it
// was their turn (with this repertoire's colour, within the first N moves) keep the move they
// played most often (ROW_NUMBER over a GROUP BY; ties go to the most recent game). Boards that
// already have a prepared move are left alone, so manual edits survive a rebuild.
export async function POST(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const repertoireId = id.parse((await context.params).id);
    const input = schema.parse(await body(request));
    await connection.beginTransaction();
    const user = await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT * FROM repertoire WHERE repertoire_id = ? FOR UPDATE", [repertoireId]);
    const rep = found(rows);
    if (user.role !== "admin" && Number(rep.owner_user_id) !== Number(user.user_id)) throw new ApiError(403, "Only the owner or an admin can change this repertoire");
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO repertoire_line (repertoire_id, start_position_id, move_san)
       SELECT ?, ranked.from_position_id, ranked.move_san FROM (
         SELECT m.from_position_id, m.move_san,
                ROW_NUMBER() OVER (PARTITION BY m.from_position_id ORDER BY COUNT(*) DESC, MAX(g.date) DESC, m.move_san) AS rn
         FROM ply m JOIN game g ON g.game_id = m.game_id
         WHERE m.side = ? AND m.ply_no <= ? AND IF(? = 'w', g.white_player_id, g.black_player_id) = ?
         GROUP BY m.from_position_id, m.move_san
         HAVING COUNT(*) >= ?
       ) ranked
       WHERE ranked.rn = 1 AND NOT EXISTS (
         SELECT 1 FROM repertoire_line x WHERE x.repertoire_id = ? AND x.start_position_id = ranked.from_position_id)`,
      [repertoireId, rep.color, input.moves * 2, rep.color, rep.player_id, input.min_games, repertoireId],
    );
    await connection.commit();
    return json({ repertoire_id: repertoireId, added: result.affectedRows }, 201);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
