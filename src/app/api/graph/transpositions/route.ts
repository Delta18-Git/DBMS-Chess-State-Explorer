import type { PoolConnection } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { errorResponse, json, pagination } from "@/lib/http";
import { int, readGraph } from "@/lib/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A transposition is a board entered from two or more DIFFERENT previous boards:
// two move-order paths merge. In the graph that is simply in-degree >= 2.
export async function GET(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const { limit, offset } = pagination(request);
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    await connection.commit();
    const rows = await readGraph(async tx => {
      const result = await tx.run(
        `MATCH (p:Position) WHERE COUNT { (p)<-[:MOVE]-() } >= 2
         MATCH (prev:Position)-[m:MOVE]->(p)
         WITH p, collect({from_position_id: prev.position_id, from_fen: prev.fen, san: m.san, games: m.games}) AS incoming,
              reduce(acc = [], ids IN collect(m.game_ids) | acc + [g IN ids WHERE NOT g IN acc]) AS game_ids
         RETURN p.position_id AS position_id, p.fen AS fen, size(incoming) AS routes,
                size(game_ids) AS games, incoming
         ORDER BY routes DESC, games DESC, position_id
         SKIP $offset LIMIT $limit`,
        { limit: int(limit), offset: int(offset) },
      );
      return result.records.map(r => r.toObject());
    });
    return json(rows);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
