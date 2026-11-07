import type { PoolConnection } from "mysql2/promise";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { errorResponse, json, pagination } from "@/lib/http";
import { int, readGraph } from "@/lib/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const filterSchema = z.object({
  eco: z.string().regex(/^[A-E][0-9]{0,2}$/).optional(),
  min_games: z.coerce.number().int().min(1).max(100000).default(1),
  min_routes: z.coerce.number().int().min(2).max(50).default(2),
  max_ply: z.coerce.number().int().min(1).max(400).optional(),
  sort: z.enum(["routes", "games", "early"]).default("games"),
});
const ORDER = { routes: "routes DESC, games DESC", games: "games DESC, routes DESC", early: "ply, games DESC" } as const;

// A transposition is a board entered from two or more DIFFERENT previous boards: two move orders
// merge. The relay labels such nodes :Transposition. For each one we return the boards it is
// entered from and up to three complete move orders from the initial position.
export async function GET(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const { limit, offset } = pagination(request);
    const f = filterSchema.parse(Object.fromEntries([...new URL(request.url).searchParams].filter(([, v]) => v !== "")));
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    await connection.commit();
    const page = await readGraph(async tx => {
      const result = await tx.run(
        `MATCH (p:Transposition)
         WHERE ($eco IS NULL OR p.eco STARTS WITH $eco) AND ($max_ply IS NULL OR p.ply <= $max_ply)
         MATCH (prev:Position)-[m:MOVE]->(p)
         WITH p, collect({from_position_id: prev.position_id, from_name: prev.name, san: m.san, games: m.games}) AS incoming,
              reduce(acc = [], ids IN collect(m.game_ids) | acc + [g IN ids WHERE NOT g IN acc]) AS game_ids
         WITH p, incoming, size(incoming) AS routes, size(game_ids) AS games, coalesce(p.ply, 0) AS ply
         WHERE games >= $min_games AND routes >= $min_routes
         WITH p, incoming, routes, games, ply ORDER BY ${ORDER[f.sort]}, p.position_id
         WITH collect({position_id: p.position_id, fen: p.fen, name: p.name, line: p.line, eco: p.eco, opening: p.opening,
                       ply: ply, routes: routes, games: games, incoming: incoming}) AS matches
         RETURN size(matches) AS total, matches[$offset..($offset + $limit)] AS rows`,
        { eco: f.eco ?? null, max_ply: f.max_ply === undefined ? null : int(f.max_ply), min_games: int(f.min_games),
          min_routes: int(f.min_routes), offset: int(offset), limit: int(limit) },
      );
      const record = result.records[0];
      const rows = (record?.get("rows") ?? []) as Record<string, unknown>[];
      if (!rows.length) return { total: Number(record?.get("total") ?? 0), rows };
      const orders = await tx.run(
        `UNWIND $ids AS id
         MATCH (s:Start), (t:Position {position_id: id})
         CALL (s, t) {
           MATCH path = allShortestPaths((s)-[:MOVE*..80]->(t))
           WITH relationships(path) AS rs LIMIT 60
           WITH rs, size(reduce(acc = head(rs).game_ids, r IN tail(rs) | [g IN acc WHERE g IN r.game_ids])) AS played
           ORDER BY played DESC LIMIT 4
           RETURN collect({moves: [r IN rs | r.san], played_by: played}) AS orders
         }
         RETURN id, orders`,
        { ids: rows.map(r => int(Number(r.position_id))) },
      );
      const byId = new Map(orders.records.map(r => [Number(r.get("id")), r.get("orders")]));
      return { total: Number(record.get("total")), rows: rows.map(r => ({ ...r, orders: byId.get(Number(r.position_id)) ?? [] })) };
    });
    // total_rows on each row matches the SQL list endpoints' pagination contract.
    return json(page.rows.map(r => ({ ...r, total_rows: page.total })));
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
