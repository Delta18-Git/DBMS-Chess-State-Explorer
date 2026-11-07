import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize, hashPassword } from "@/lib/auth";
import { body, errorResponse, json } from "@/lib/http";
import { userSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Account management (admin only). Password hashes never leave the database.
export async function GET(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request, "admin");
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT u.user_id, u.email, u.display_name, u.role, u.created_at, u.locked_until > UTC_TIMESTAMP() AS locked,
              (SELECT COUNT(*) FROM repertoire r WHERE r.owner_user_id = u.user_id) AS repertoires,
              (SELECT MAX(s.expires_at) FROM api_session s WHERE s.user_id = u.user_id) AS session_expires_at
       FROM app_user u ORDER BY u.role, u.email`,
    );
    await connection.commit();
    return json(rows);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}

export async function POST(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const input = userSchema.parse(await body(request));
    const hash = await hashPassword(input.password);
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [result] = await connection.execute<ResultSetHeader>(
      "INSERT INTO app_user (email, display_name, password_hash, role) VALUES (?, ?, ?, ?)",
      [input.email, input.display_name, hash, input.role],
    );
    await connection.commit();
    return json({ user_id: result.insertId, email: input.email, display_name: input.display_name, role: input.role }, 201);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
