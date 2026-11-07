import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { ApiError, errorResponse, found, id, json, type IdContext } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Deleting an account cascades its sessions (FK ON DELETE CASCADE) and keeps its repertoires
// (owner set to NULL by ON DELETE SET NULL). Admins cannot delete themselves or the last admin.
export async function DELETE(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const userId = id.parse((await context.params).id);
    await connection.beginTransaction();
    const me = await authorize(connection, request, "admin");
    if (Number(me.user_id) === userId) throw new ApiError(409, "You cannot delete your own account");
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT user_id, role FROM app_user WHERE user_id = ? FOR UPDATE", [userId]);
    const user = found(rows);
    if (user.role === "admin") {
      const [[admins]] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM app_user WHERE role = 'admin' FOR UPDATE");
      if (Number(admins.n) <= 1) throw new ApiError(409, "Keep at least one admin account");
    }
    await connection.execute("DELETE FROM app_user WHERE user_id = ?", [userId]);
    await connection.commit();
    return json({ deleted: userId });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
