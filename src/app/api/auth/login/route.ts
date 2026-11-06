import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { body, ApiError, errorResponse, json } from "@/lib/http";
import { loginSchema } from "@/lib/validation";
import { hashPassword, newToken, tokenHash, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const input = loginSchema.parse(await body(request));
    await connection.beginTransaction();
    const [users] = await connection.execute<RowDataPacket[]>(
      "SELECT *, locked_until > UTC_TIMESTAMP() AS locked FROM app_user WHERE email = ? FOR UPDATE", [input.email],
    );
    const user = users[0];
    if (Number(user?.locked) === 1) throw new ApiError(429, "Account temporarily locked; retry in 15 minutes");
    // Same scrypt cost for unknown accounts; never disclose whether an email exists.
    const dummyHash = `scrypt-v2:${"0".repeat(32)}:${"0".repeat(128)}`;
    const valid = await verifyPassword(input.password, user?.password_hash ?? dummyHash);
    if (!user || !valid) {
      if (user) {
        await connection.execute(
          `UPDATE app_user SET
           failed_attempts = IF(locked_until IS NOT NULL AND locked_until <= UTC_TIMESTAMP(), 1, failed_attempts + 1),
           locked_until = IF(failed_attempts >= 5, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), NULL)
           WHERE user_id = ?`, [user.user_id],
        );
      }
      // Failed-attempt counters must survive a rejected login.
      await connection.commit();
      throw new ApiError(401, "Invalid email or password");
    }
    const passwordHash = user.password_hash.startsWith("scrypt:") ? await hashPassword(input.password) : user.password_hash;
    await connection.execute<ResultSetHeader>("UPDATE app_user SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE user_id = ?", [passwordHash, user.user_id]);
    await connection.execute("DELETE FROM api_session WHERE expires_at <= UTC_TIMESTAMP()");
    const token = newToken();
    await connection.execute(
      "INSERT INTO api_session (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 12 HOUR))",
      [tokenHash(token), user.user_id],
    );
    await connection.commit();
    return json({ token, expires_in: 43200, user: { user_id: user.user_id, email: user.email, role: user.role } });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
