import type { PoolConnection } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize, bearer, tokenHash } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    await connection.beginTransaction();
    await authorize(connection, request);
    await connection.execute("DELETE FROM api_session WHERE token_hash = ?", [tokenHash(bearer(request))]);
    await connection.commit();
    return json({ logged_out: true });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
