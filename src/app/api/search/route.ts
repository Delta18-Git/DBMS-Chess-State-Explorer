import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { booleanQuery } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().min(1).max(100),
  type: z.enum(["all", "player", "opening", "tournament"]).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// FULLTEXT MATCH ... AGAINST over players, openings and tournaments, ranked by relevance.
export async function GET(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const { q, type, limit } = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const terms = booleanQuery(q);
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const out: Record<string, RowDataPacket[]> = {};
    if (type === "all" || type === "player") {
      [out.players] = await connection.execute<RowDataPacket[]>(
        `SELECT p.*, MATCH(p.name) AGAINST (? IN BOOLEAN MODE) AS score,
                (SELECT COUNT(*) FROM game g WHERE g.white_player_id = p.player_id OR g.black_player_id = p.player_id) AS games
         FROM player p WHERE MATCH(p.name) AGAINST (? IN BOOLEAN MODE)
         ORDER BY score DESC, p.rating DESC LIMIT ?`, [terms, terms, String(limit)],
      );
    }
    if (type === "all" || type === "opening") {
      [out.openings] = await connection.execute<RowDataPacket[]>(
        `SELECT o.*, MATCH(o.name) AGAINST (? IN BOOLEAN MODE) AS score
         FROM opening o WHERE MATCH(o.name) AGAINST (? IN BOOLEAN MODE) OR o.eco = UPPER(?)
         ORDER BY score DESC, o.eco LIMIT ?`, [terms, terms, q, String(limit)],
      );
    }
    if (type === "all" || type === "tournament") {
      [out.tournaments] = await connection.execute<RowDataPacket[]>(
        `SELECT t.*, MATCH(t.name, t.location) AGAINST (? IN BOOLEAN MODE) AS score
         FROM tournament t WHERE MATCH(t.name, t.location) AGAINST (? IN BOOLEAN MODE)
         ORDER BY score DESC LIMIT ?`, [terms, terms, String(limit)],
      );
    }
    await connection.commit();
    return json({ q, query: terms, ...out });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
