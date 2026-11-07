import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { canonicalFen, parseGame } from "@/lib/chess";
import { body, errorResponse, id, json, pagination } from "@/lib/http";
import { gameSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const filterSchema = z.object({
  player_id: id.optional(), opening_id: id.optional(), tournament_id: id.optional(),
  eco: z.string().regex(/^[A-E]([0-9]{0,2})$/).optional(),
  result: z.enum(["1-0", "0-1", "1/2-1/2", "*"]).optional(),
  color: z.enum(["w", "b"]).optional(),
  sort: z.enum(["date", "white", "black", "opening", "event", "moves", "rating", "result", "round", "recent", "oldest", "longest"]).default("date"),
  dir: z.enum(["asc", "desc"]).optional(),
});
// Whitelisted ORDER BY expressions (never user text). "recent/oldest/longest" are kept as aliases.
const ROUND = "CAST(SUBSTRING_INDEX(g.round, '.', 1) AS UNSIGNED) %, CAST(SUBSTRING_INDEX(g.round, '.', -1) AS UNSIGNED) %";
const ORDER: Record<string, [string, "asc" | "desc"]> = {
  date: [`g.date %, ${ROUND}`, "desc"], white: ["w.name %", "asc"], black: ["b.name %", "asc"],
  opening: ["o.eco %, o.name %", "asc"], event: [`t.name %, ${ROUND}`, "asc"], moves: ["plies %", "desc"],
  rating: ["(COALESCE(g.white_elo, 0) + COALESCE(g.black_elo, 0)) %", "desc"], result: ["g.result %", "asc"],
  round: [ROUND, "asc"], recent: [`g.date %, ${ROUND}`, "desc"], oldest: [`g.date %, ${ROUND}`, "asc"], longest: ["plies %", "desc"],
};

const order = (sort: string, dir?: "asc" | "desc") => {
  const [expr, def] = ORDER[sort];
  return expr.replaceAll("%", (dir ?? def).toUpperCase());
};

// Filtered, sorted game list. COUNT(*) OVER () returns the full match count with each page.
export async function GET(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const { limit, offset } = pagination(request);
    const params = Object.fromEntries([...new URL(request.url).searchParams].filter(([, v]) => v !== ""));
    const f = filterSchema.parse(params);
    const player = f.player_id ?? null, opening = f.opening_id ?? null, tournament = f.tournament_id ?? null;
    const color = f.color && player ? f.color : null;
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT g.game_id, g.white_player_id, w.name AS white_name, w.title AS white_title, w.federation AS white_federation,
              g.black_player_id, b.name AS black_name, b.title AS black_title, b.federation AS black_federation,
              g.white_elo, g.black_elo, g.tournament_id, t.name AS tournament_name, g.round,
              g.opening_id, o.eco, o.name AS opening_name, g.date, g.result,
              (SELECT MAX(m.ply_no) FROM ply m WHERE m.game_id = g.game_id) AS plies,
              COUNT(*) OVER () AS total_rows
       FROM game g JOIN player w ON w.player_id = g.white_player_id JOIN player b ON b.player_id = g.black_player_id
       LEFT JOIN tournament t ON t.tournament_id = g.tournament_id LEFT JOIN opening o ON o.opening_id = g.opening_id
       WHERE (? IS NULL OR (? IS NULL AND (g.white_player_id = ? OR g.black_player_id = ?))
                        OR (? = 'w' AND g.white_player_id = ?) OR (? = 'b' AND g.black_player_id = ?))
         AND (? IS NULL OR g.opening_id = ?) AND (? IS NULL OR g.tournament_id = ?)
         AND (? IS NULL OR o.eco LIKE CONCAT(?, '%')) AND (? IS NULL OR g.result = ?)
       ORDER BY ${order(f.sort, f.dir)}, g.game_id LIMIT ? OFFSET ?`,
      [player, color, player, player, color, player, color, player, opening, opening, tournament, tournament,
       f.eco ?? null, f.eco ?? null, f.result ?? null, f.result ?? null, String(limit), String(offset)],
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
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const input = gameSchema.parse(await body(request));
    const parsed = parseGame(input.pgn, input.result);
    const plies = parsed.moves.map((move, index) => ({
      ply_no: index + 1, side: move.color, move_san: move.san,
      from: canonicalFen(move.before), to: canonicalFen(move.after),
    }));
    // A stable lock order reduces deadlocks when concurrent imports share positions.
    const fens = [...new Set(plies.flatMap(p => [p.from, p.to]))].sort();
    // Deduplication and the game/plies are ONE transaction. FK failure rolls back new nodes too.
    await connection.execute(
      `INSERT INTO \`position\` (fen) VALUES ${fens.map(() => "(?)").join(",")}
       ON DUPLICATE KEY UPDATE position_id = position_id`, fens,
    );
    const [positions] = await connection.execute<RowDataPacket[]>(
      `SELECT position_id, fen FROM \`position\` WHERE fen IN (${fens.map(() => "?").join(",")}) FOR SHARE`, fens,
    );
    const positionIds = new Map<string, number>(positions.map(p => [p.fen, p.position_id]));
    const [result] = await connection.execute<ResultSetHeader>(
      "INSERT INTO game (white_player_id, black_player_id, tournament_id, opening_id, date, result, pgn) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [input.white_player_id, input.black_player_id, input.tournament_id, input.opening_id, input.date, parsed.result, parsed.pgn],
    );
    await connection.execute(
      `INSERT INTO ply (game_id, ply_no, side, move_san, from_position_id, to_position_id)
       VALUES ${plies.map(() => "(?, ?, ?, ?, ?, ?)").join(",")}`,
      plies.flatMap(p => [result.insertId, p.ply_no, p.side, p.move_san, positionIds.get(p.from)!, positionIds.get(p.to)!]),
    );
    await connection.commit();
    return json({ game_id: result.insertId, result: parsed.result, plies: plies.length, positions: fens.length }, 201);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
