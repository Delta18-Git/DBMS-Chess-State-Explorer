import { availableParallelism } from "node:os";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { body, errorResponse, foreignId, json } from "@/lib/http";
import { scorePositions } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  game_id: foreignId.optional(), tournament_id: foreignId.optional(), position_id: foreignId.optional(),
  depth: z.number().int().min(6).max(24).default(14),
  limit: z.number().int().min(1).max(20000).default(500),
  rescore: z.boolean().default(false),
}).strict();

// Runs Stockfish (bundled WASM build, or STOCKFISH_PATH) on boards that have no evaluation yet.
// 1) read-only transaction picks the boards, 2) the engine runs with NO transaction open,
// 3) one write transaction inserts every score; trg_evaluation_insert audits each row.
export async function POST(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const input = schema.parse(await body(request));
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request, "admin");
    const [boards] = await connection.execute<RowDataPacket[]>(
      `SELECT p.position_id, p.fen FROM \`position\` p
       WHERE (? IS NULL OR p.position_id = ?)
         AND p.position_id IN (SELECT IF(m.ply_no = 1 AND k.n = 0, m.from_position_id, m.to_position_id)
                               FROM ply m JOIN game g ON g.game_id = m.game_id
                               JOIN (SELECT 0 AS n UNION ALL SELECT 1) k ON k.n = 1 OR m.ply_no = 1
                               WHERE (? IS NULL OR g.game_id = ?) AND (? IS NULL OR g.tournament_id = ?))
         AND (? = 1 OR NOT EXISTS (SELECT 1 FROM evaluation e WHERE e.position_id = p.position_id AND e.depth >= ?))
       ORDER BY p.position_id LIMIT ?`,
      [input.position_id ?? null, input.position_id ?? null, input.game_id ?? null, input.game_id ?? null,
       input.tournament_id ?? null, input.tournament_id ?? null, Number(input.rescore || input.position_id !== undefined), input.depth, String(input.limit)],
    );
    await connection.commit();
    if (!boards.length) return json({ scored: 0, remaining: false, depth: input.depth });

    const workers = Number(process.env.ENGINE_WORKERS) || Math.max(1, Math.min(8, Math.floor(availableParallelism() / 2)));
    const scores = await scorePositions(boards.map(b => b.fen as string), { depth: input.depth, workers });
    const byFen = new Map(boards.map(b => [b.fen as string, Number(b.position_id)]));
    const rows = scores.map(s => [byFen.get(s.fen)!, s.cp, s.mate, s.depth, s.best_move_san]);

    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      await connection.execute(
        `INSERT INTO evaluation (position_id, cp, mate, depth, best_move_san) VALUES ${batch.map(() => "(?, ?, ?, ?, ?)").join(",")}`,
        batch.flat(),
      );
    }
    await connection.commit();
    return json({ scored: rows.length, remaining: boards.length === input.limit, depth: input.depth, workers }, 201);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
