import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { errorResponse, found, id, json, type IdContext } from "@/lib/http";
import { int, nodeFacts, readGraph, type GraphNode } from "@/lib/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

// Every minimal-length move order from the initial board to this board: the core transposition
// query. Paths may stitch together moves from DIFFERENT games; `played_by` is the set of games
// that played the whole order, so an empty set marks an order that no single stored game used.
export async function GET(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const positionId = id.parse((await context.params).id);
    const { limit } = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT position_id, fen FROM `position` WHERE position_id = ?", [positionId]);
    const position = found(rows);
    await connection.commit();
    const result = await readGraph(async tx => {
      const target = await tx.run(
        "MATCH (t:Position {position_id: $id}) RETURN t.is_start AS is_start",
        { id: int(positionId) },
      );
      if (!target.records.length) return { in_graph: false, paths: [], nodes: [] as GraphNode[] };
      if (target.records[0].get("is_start")) return { in_graph: true, paths: [{ depth: 0, moves: [], position_ids: [positionId], edge_games: [], played_by: [] }], nodes: await nodeFacts(tx, [positionId]) };
      const paths = await tx.run(
        `MATCH (s:Position {is_start: true}), (t:Position {position_id: $id})
         MATCH p = allShortestPaths((s)-[:MOVE*..500]->(t))
         WITH p, relationships(p) AS rs LIMIT 200
         WITH p, rs, reduce(acc = head(rs).game_ids, r IN tail(rs) | [g IN acc WHERE g IN r.game_ids]) AS played_by
         ORDER BY size(played_by) DESC, reduce(s = 0, r IN rs | s + r.games) DESC LIMIT $limit
         RETURN length(p) AS depth,
                [r IN rs | r.san] AS moves,
                [n IN nodes(p) | n.position_id] AS position_ids,
                [r IN rs | r.games] AS edge_games,
                played_by`,
        { id: int(positionId), limit: int(limit) },
      );
      const list = paths.records.map(r => r.toObject());
      return { in_graph: true, paths: list, nodes: await nodeFacts(tx, list.flatMap(p => p.position_ids as number[])) };
    });
    const orders = result.paths.length;
    return json({
      position, ...result,
      move_orders: orders,
      unplayed_orders: result.paths.filter(p => !(p.played_by as number[]).length && p.depth > 0).length,
      is_transposition: orders >= 2,
    });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
