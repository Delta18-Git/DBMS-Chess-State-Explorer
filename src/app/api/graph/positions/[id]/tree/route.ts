import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { errorResponse, found, id, json, type IdContext } from "@/lib/http";
import { int, readGraph } from "@/lib/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  depth: z.coerce.number().int().min(1).max(4).default(2),
  min_games: z.coerce.number().int().min(1).max(100000).default(1),
});
const MAX_EDGES = 400;

// Opening tree: every continuation reachable within N plies (variable-length traversal),
// optionally pruned to moves played in at least `min_games` games.
export async function GET(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const positionId = id.parse((await context.params).id);
    const { depth, min_games } = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT position_id, fen FROM `position` WHERE position_id = ?", [positionId]);
    const root = found(rows);
    await connection.commit();
    const edges = await readGraph(async tx => {
      // Variable-length bounds cannot be parameters in Cypher; `depth` is a zod-validated integer 1–4.
      const result = await tx.run(
        `MATCH (root:Position {position_id: $id})
         MATCH p = (root)-[:MOVE*1..${depth}]->(:Position)
         WHERE all(r IN relationships(p) WHERE r.games >= $min_games)
         UNWIND relationships(p) AS r
         WITH r, min(length(p)) AS ply_offset
         WITH r, ply_offset ORDER BY ply_offset, r.games DESC LIMIT $max
         RETURN startNode(r).position_id AS from_position_id, endNode(r).position_id AS to_position_id,
                endNode(r).fen AS to_fen, r.san AS san, r.games AS games,
                r.white_wins AS white_wins, r.black_wins AS black_wins, r.draws AS draws`,
        { id: int(positionId), min_games: int(min_games), max: int(MAX_EDGES + 1) },
      );
      return result.records.map(r => r.toObject());
    });
    const truncated = edges.length > MAX_EDGES;
    const kept = edges.slice(0, MAX_EDGES);
    const branching = new Map<number, number>();
    for (const e of kept) branching.set(e.from_position_id, (branching.get(e.from_position_id) ?? 0) + 1);
    return json({
      root, depth, min_games, truncated, edges: kept,
      branch_points: [...branching.values()].filter(n => n >= 2).length,
      max_branching: Math.max(0, ...branching.values()),
    });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
