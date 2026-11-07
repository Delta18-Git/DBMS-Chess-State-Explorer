import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Values for the player filters: titles and federations actually present, with counts.
export async function GET(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [titles] = await connection.query<RowDataPacket[]>(
      "SELECT title, COUNT(*) AS players FROM player WHERE title IS NOT NULL GROUP BY title ORDER BY players DESC, title",
    );
    const [federations] = await connection.query<RowDataPacket[]>(
      "SELECT federation, COUNT(*) AS players FROM player WHERE federation IS NOT NULL GROUP BY federation ORDER BY federation",
    );
    await connection.commit();
    return json({ titles, federations });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
