import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { body, errorResponse, json, pagination } from "@/lib/http";
import { booleanQuery, playerSchema } from "@/lib/validation";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const filterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  title: z.string().trim().max(10).optional(),
  federation: z.string().regex(/^[A-Z]{3}$/).optional(),
  sort: z.enum(["rating", "name", "games", "score", "federation", "born"]).default("rating"),
  dir: z.enum(["asc", "desc"]).optional(),
});
// Whitelisted ORDER BY expressions; % is replaced by the direction. NULLs always sort last.
const ORDER: Record<string, [string, "asc" | "desc"]> = {
  rating: ["p.rating IS NULL, p.rating %", "desc"], name: ["p.name %", "asc"], games: ["games %", "desc"],
  score: ["score_pct IS NULL, score_pct %, games DESC", "desc"], federation: ["p.federation IS NULL, p.federation %", "asc"],
  born: ["p.birth_year IS NULL, p.birth_year %", "asc"],
};

// Players with their record (from v_player_game), FULLTEXT name search and facet filters.
export async function GET(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const { limit, offset } = pagination(request);
    const f = filterSchema.parse(Object.fromEntries([...new URL(request.url).searchParams].filter(([, v]) => v !== "")));
    const terms = f.q ? booleanQuery(f.q) : null;
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT p.*, COALESCE(s.games, 0) AS games, s.points, s.score_pct, s.wins, s.draws, s.losses,
              COUNT(*) OVER () AS total_rows
       FROM player p
       LEFT JOIN (SELECT player_id, COUNT(*) AS games, SUM(score) AS points, ROUND(100 * AVG(score), 1) AS score_pct,
                         SUM(score = 1) AS wins, SUM(score = 0.5) AS draws, SUM(score = 0) AS losses
                  FROM v_player_game WHERE result <> '*' GROUP BY player_id) s ON s.player_id = p.player_id
       WHERE (? IS NULL OR MATCH(p.name) AGAINST (? IN BOOLEAN MODE))
         AND (? IS NULL OR p.title = ?) AND (? IS NULL OR p.federation = ?)
       ORDER BY ${ORDER[f.sort][0].replaceAll("%", (f.dir ?? ORDER[f.sort][1]).toUpperCase())}, p.player_id LIMIT ? OFFSET ?`,
      [terms, terms, f.title ?? null, f.title ?? null, f.federation ?? null, f.federation ?? null, String(limit), String(offset)],
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
    const p = { title: null, federation: null, birth_year: null, rating: null, ...playerSchema.parse(await body(request)) };
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [result] = await connection.execute<ResultSetHeader>(
      "INSERT INTO player (name, title, federation, birth_year, rating) VALUES (?, ?, ?, ?, ?)",
      [p.name, p.title, p.federation, p.birth_year, p.rating],
    );
    await connection.commit();
    return json({ player_id: result.insertId, ...p }, 201);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
