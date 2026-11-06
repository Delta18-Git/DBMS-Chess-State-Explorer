import { getPool } from "@/lib/db";
import { authorize, bearer, tokenHash } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await authorize(connection, request);
    await connection.execute("DELETE FROM api_session WHERE token_hash = ?", [tokenHash(bearer(request))]);
    await connection.commit();
    return json({ logged_out: true });
  } catch (error) { await connection.rollback(); return errorResponse(error); }
  finally { connection.release(); }
}
