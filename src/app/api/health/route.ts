import type { PoolConnection } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { ApiError, errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  // Liveness is public; do not reveal credentials, server versions or SQL errors.
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    await connection.query("START TRANSACTION READ ONLY");
    await connection.query("SELECT 1 FROM player LIMIT 1");
    await connection.commit();
    return json({ status: "ok", database: "mysql" });
  } catch {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(new ApiError(503, "Database unavailable or uninitialized"));
  } finally { connection?.release(); }
}
