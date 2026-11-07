import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { errorResponse, found, id, json, type IdContext } from "@/lib/http";
import { int, readGraph } from "@/lib/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Novelty detection: walk a game's moves through the shared move graph. While each move is
// also on other games' edges the game is "in book"; the first move no other stored game played
// from that board is the novelty. Ply order comes from MySQL, popularity from Neo4j.
export async function GET(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const gameId = id.parse((await context.params).id);
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [games] = await connection.execute<RowDataPacket[]>("SELECT game_id, result FROM game WHERE game_id = ?", [gameId]);
    found(games);
    const [plies] = await connection.execute<RowDataPacket[]>(
      `SELECT m.ply_no, m.move_san, m.from_position_id, m.to_position_id, p.fen AS from_fen
       FROM ply m JOIN \`position\` p ON p.position_id = m.from_position_id
       WHERE m.game_id = ? ORDER BY m.ply_no`, [gameId],
    );
    const [[pending]] = await connection.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM graph_outbox WHERE game_id = ? AND processed_at IS NULL", [gameId],
    );
    await connection.commit();
    if (Number(pending.n) > 0) return json({ game_id: gameId, synced: false, novelty: null, plies: [] });

    const stats = await readGraph(async tx => {
      const result = await tx.run(
        `UNWIND $plies AS k
         MATCH (a:Position {position_id: k.from})-[m:MOVE {san: k.san}]->(:Position {position_id: k.to})
         RETURN k.ply_no AS ply_no, m.games AS games, m.game_ids AS game_ids,
                COUNT { (a)-[:MOVE]->() } AS options`,
        { plies: plies.map(p => ({ ply_no: int(p.ply_no), from: int(p.from_position_id), to: int(p.to_position_id), san: p.move_san })) },
      );
      return new Map(result.records.map(r => [r.get("ply_no") as number, r.toObject()]));
    });

    let shared: number[] | null = null;
    let novelty = null;
    const timeline = [];
    for (const p of plies) {
      const s = stats.get(p.ply_no);
      const others = s ? (s.game_ids as number[]).filter(g => g !== gameId) : [];
      timeline.push({ ply_no: p.ply_no, san: p.move_san, games: s?.games ?? 0, options: s?.options ?? 0 });
      if (novelty) continue;
      if (!others.length) {
        const alternatives = await readGraph(async tx => (await tx.run(
          `MATCH (:Position {position_id: $from})-[m:MOVE]->(:Position)
           WHERE NOT $game IN m.game_ids
           RETURN m.san AS san, m.games AS games ORDER BY games DESC, san`,
          { from: int(p.from_position_id), game: int(gameId) },
        )).records.map(r => r.toObject()));
        novelty = {
          ply_no: p.ply_no, san: p.move_san, from_position_id: p.from_position_id, from_fen: p.from_fen,
          book_plies: p.ply_no - 1, alternatives, reference_games: shared ?? [],
        };
      } else {
        shared = shared === null ? others : shared.filter(g => others.includes(g));
      }
    }
    return json({ game_id: gameId, synced: true, novelty, plies: timeline });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
