import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { errorResponse, found, id, json, type IdContext } from "@/lib/http";

export const runtime = "nodejs";
export async function DELETE(request: Request, context: IdContext) {
  const connection = await getPool().getConnection();
  try {
    const evaluationId = id.parse((await context.params).id);
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT evaluation_id FROM evaluation WHERE evaluation_id = ? FOR UPDATE", [evaluationId]);
    found(rows);
    await connection.execute("DELETE FROM evaluation WHERE evaluation_id = ?", [evaluationId]);
    // The delete trigger preserves the old score in evaluation_audit.
    await connection.commit();
    return json({ deleted: evaluationId });
  } catch (error) { await connection.rollback(); return errorResponse(error); }
  finally { connection.release(); }
}
