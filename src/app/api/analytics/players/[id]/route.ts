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
      `SELECT game_id, ply_no, side, move_san, before_cp, after_cp, cp_loss FROM v_ply_analysis
       WHERE player_id = ? AND cp_loss >= 200 ORDER BY cp_loss DESC, game_id, ply_no LIMIT ? OFFSET ?`,
      [playerId, String(limit), String(offset)],
    );
    await connection.commit();
    return json({ summary, blunders });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
