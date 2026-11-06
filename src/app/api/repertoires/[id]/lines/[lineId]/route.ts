import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { ApiError, errorResponse, id, json } from "@/lib/http";

export const runtime = "nodejs";
export async function DELETE(request: Request, context: { params: Promise<{ id: string; lineId: string }> }) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const params = await context.params;
    const repertoireId = id.parse(params.id);
    const lineId = id.parse(params.lineId);
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [result] = await connection.execute<ResultSetHeader>("DELETE FROM repertoire_line WHERE repertoire_line_id = ? AND repertoire_id = ?", [lineId, repertoireId]);
    if (!result.affectedRows) throw new ApiError(404, "Repertoire line not found");
    await connection.commit();
    return json({ deleted: lineId });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
