import { getPool } from "@/lib/db";
import { json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  // Liveness is public; do not reveal credentials, server versions or SQL errors.
  try {
    const connection = await getPool().getConnection();
    try {
      await connection.query("START TRANSACTION READ ONLY");
      await connection.query("SELECT 1 FROM player LIMIT 1");
      await connection.commit();
      return json({ status: "ok", database: "mysql" });
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  } catch { return Response.json({ error: { message: "Database unavailable or uninitialized" } }, { status: 503 }); }
}
