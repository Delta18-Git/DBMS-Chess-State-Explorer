import { z } from "zod";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { errorResponse, json, pagination } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const { limit, offset } = pagination(request);
    const params = new URL(request.url).searchParams;
    const minGames = z.coerce.number().int().min(1).max(1000000).parse(params.get("min_games") ?? 1);
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT o.opening_id, o.eco, o.name, COUNT(*) AS games,
              SUM(g.result = '1-0') AS white_wins, SUM(g.result = '0-1') AS black_wins,
              SUM(g.result = '1/2-1/2') AS draws, SUM(g.result = '*') AS unfinished,
              ROUND(100.0 * SUM(g.result = '1-0') / NULLIF(SUM(g.result <> '*'), 0), 2) AS white_win_pct,
              ROUND(100.0 * (SUM(g.result = '1-0') + 0.5 * SUM(g.result = '1/2-1/2')) /
                    NULLIF(SUM(g.result <> '*'), 0), 2) AS white_score_pct
       FROM opening o JOIN game g ON g.opening_id = o.opening_id
       GROUP BY o.opening_id, o.eco, o.name HAVING COUNT(*) >= ?
       ORDER BY games DESC, o.opening_id LIMIT ? OFFSET ?`, [minGames, String(limit), String(offset)],
    );
    await connection.commit();
    return json(rows);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
