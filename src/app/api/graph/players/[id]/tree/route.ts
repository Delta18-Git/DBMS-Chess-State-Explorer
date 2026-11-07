import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { errorResponse, found, id, json, type IdContext } from "@/lib/http";
import { int, nodeFacts, readGraph } from "@/lib/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({ color: z.enum(["w", "b"]).default("w"), depth: z.coerce.number().int().min(2).max(20).default(10) });

// A player's personal opening graph: the shared MOVE edges restricted to the games they played
// with one colour (MySQL picks the games, Neo4j filters edges by their game_ids). Where two of
// their own move orders meet, the node is a transposition inside their repertoire.
export async function GET(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const playerId = id.parse((await context.params).id);
    const { color, depth } = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [players] = await connection.execute<RowDataPacket[]>("SELECT player_id, name FROM player WHERE player_id = ?", [playerId]);
    found(players);
    const [games] = await connection.execute<RowDataPacket[]>(
      "SELECT game_id, score FROM v_player_game WHERE player_id = ? AND color = ? AND result <> '*'", [playerId, color],
    );
    await connection.commit();
    const score = new Map(games.map(g => [Number(g.game_id), Number(g.score)]));
    if (!score.size) return json({ color, depth, games: 0, edges: [], nodes: [] });
    const graph = await readGraph(async tx => {
      const result = await tx.run(
        `MATCH (a:Position)-[r:MOVE]->(b:Position)
         WHERE coalesce(a.ply, 0) < $depth AND any(g IN r.game_ids WHERE g IN $ids)
         RETURN a.position_id AS from_position_id, b.position_id AS to_position_id, r.san AS san,
                [g IN r.game_ids WHERE g IN $ids] AS game_ids`,
        { ids: [...score.keys()].map(int), depth: int(depth) },
      );
      const edges = result.records.map(r => {
        const ids = r.get("game_ids") as number[];
        const pts = ids.map(g => score.get(g) ?? 0);
        return {
          from_position_id: r.get("from_position_id"), to_position_id: r.get("to_position_id"), san: r.get("san"),
          games: ids.length, game_ids: ids,
          wins: pts.filter(p => p === 1).length, draws: pts.filter(p => p === 0.5).length, losses: pts.filter(p => p === 0).length,
        };
      });
      return { edges, nodes: await nodeFacts(tx, edges.flatMap(e => [e.from_position_id, e.to_position_id])) };
    });
    return json({ color, depth, games: score.size, ...graph });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
