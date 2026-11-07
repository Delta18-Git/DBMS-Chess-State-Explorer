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
    const minGames = z.coerce.number().int().min(1).max(1000000).parse(params.get("min_games") || 1);
    const eco = z.string().regex(/^[A-E][0-9]{0,2}$/).nullable().parse(params.get("eco") || null);
    const q = z.string().trim().max(100).nullable().parse(params.get("q") || null);
    const sort = z.enum(["games", "white", "black", "eco", "name", "moves", "last"]).parse(params.get("sort") || "games");
    const dirParam = z.enum(["asc", "desc"]).nullable().parse(params.get("dir") || null);
    // Whitelisted ORDER BY expressions; % is replaced by the direction.
    const ORDER: Record<string, [string, "asc" | "desc"]> = {
      games: ["games %, o.eco", "desc"], white: ["white_score_pct %, games DESC", "desc"], black: ["white_score_pct %, games DESC", "asc"],
      eco: ["o.eco %, o.name", "asc"], name: ["o.name %", "asc"], moves: ["avg_moves %", "desc"], last: ["last_played %", "desc"],
    };
    const order = ORDER[sort][0].replaceAll("%", (dirParam ?? ORDER[sort][1]).toUpperCase());
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT o.opening_id, o.eco, o.name, COUNT(*) AS games,
              SUM(g.result = '1-0') AS white_wins, SUM(g.result = '0-1') AS black_wins,
              SUM(g.result = '1/2-1/2') AS draws, SUM(g.result = '*') AS unfinished,
              ROUND(100.0 * SUM(g.result = '1-0') / NULLIF(SUM(g.result <> '*'), 0), 2) AS white_win_pct,
              ROUND(100.0 * (SUM(g.result = '1-0') + 0.5 * SUM(g.result = '1/2-1/2')) /
                    NULLIF(SUM(g.result <> '*'), 0), 2) AS white_score_pct,
              ROUND(AVG((SELECT MAX(m.ply_no) FROM ply m WHERE m.game_id = g.game_id)) / 2) AS avg_moves,
              MAX(g.date) AS last_played, COUNT(*) OVER () AS total_rows
       FROM opening o JOIN game g ON g.opening_id = o.opening_id
       WHERE (? IS NULL OR o.eco LIKE CONCAT(?, '%')) AND (? IS NULL OR o.name LIKE CONCAT('%', ?, '%'))
       GROUP BY o.opening_id, o.eco, o.name HAVING COUNT(*) >= ?
       ORDER BY ${order}, o.opening_id LIMIT ? OFFSET ?`, [eco, eco, q, q, minGames, String(limit), String(offset)],
    );
    await connection.commit();
    return json(rows);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
