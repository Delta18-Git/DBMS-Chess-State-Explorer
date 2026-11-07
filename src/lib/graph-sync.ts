import type { PoolConnection, Connection, RowDataPacket } from "mysql2/promise";
import { applyEdges, clearGraph, edgesForGames, ensureGraphSchema, ensureStartNode, START_FEN, type EdgeKey, type MoveEdge } from "./graph";

// Outbox relay between MySQL and Neo4j. The CALLER owns the MySQL transaction
// (BEGIN before, COMMIT/ROLLBACK after), matching the project's route-owned-transaction rule.
// Neo4j cannot join a MySQL transaction, so correctness comes from idempotence instead:
//  1. lock pending outbox rows (FOR UPDATE SKIP LOCKED: concurrent relays never double-claim),
//  2. recompute every affected edge from MySQL's v_move_edge view,
//  3. write Neo4j,
//  4. mark rows processed; the caller commits.
// If Neo4j fails, the caller rolls back and rows stay pending. If the commit fails after Neo4j
// succeeded, replaying recomputes the same edges, so at-least-once delivery is safe.

type Db = PoolConnection | Connection;
const key = (e: EdgeKey) => `${e.from_position_id}|${e.to_position_id}|${e.move_san}`;

interface EdgeRow extends RowDataPacket, Omit<MoveEdge, "game_ids"> { game_ids: number[] | string }

function toEdge(row: EdgeRow): MoveEdge {
  const ids = typeof row.game_ids === "string" ? JSON.parse(row.game_ids) as number[] : row.game_ids;
  return {
    from_position_id: Number(row.from_position_id), to_position_id: Number(row.to_position_id), move_san: row.move_san,
    from_fen: row.from_fen, to_fen: row.to_fen,
    games: Number(row.games), white_wins: Number(row.white_wins), black_wins: Number(row.black_wins), draws: Number(row.draws),
    game_ids: [...new Set(ids.map(Number))].sort((a, b) => a - b),
  };
}

const EDGE_SELECT = `SELECT e.from_position_id, e.to_position_id, e.move_san, e.games, e.white_wins, e.black_wins,
       e.draws, e.game_ids, pf.fen AS from_fen, pt.fen AS to_fen
FROM v_move_edge e
JOIN \`position\` pf ON pf.position_id = e.from_position_id
JOIN \`position\` pt ON pt.position_id = e.to_position_id`;

async function startPositionId(connection: Db) {
  const [rows] = await connection.execute<RowDataPacket[]>("SELECT position_id FROM `position` WHERE fen = ?", [START_FEN]);
  return rows.length ? Number(rows[0].position_id) : null;
}

export async function drainOutbox(connection: Db, limit = 200) {
  const [pending] = await connection.execute<RowDataPacket[]>(
    `SELECT outbox_id, game_id FROM graph_outbox WHERE processed_at IS NULL
     ORDER BY outbox_id LIMIT ? FOR UPDATE SKIP LOCKED`, [String(limit)],
  );
  if (!pending.length) return { processed: 0, games: 0, edges_upserted: 0, edges_removed: 0 };
  const gameIds = [...new Set(pending.map(r => Number(r.game_id)))];

  // Affected edges = what MySQL says these games played now ∪ what the graph thinks they played.
  const marks = gameIds.map(() => "?").join(",");
  const [current] = await connection.execute<RowDataPacket[]>(
    `SELECT DISTINCT from_position_id, to_position_id, move_san FROM ply WHERE game_id IN (${marks})`, gameIds,
  );
  const affected = new Map<string, EdgeKey>();
  for (const row of current) {
    const k = { from_position_id: Number(row.from_position_id), to_position_id: Number(row.to_position_id), move_san: String(row.move_san) };
    affected.set(key(k), k);
  }
  for (const k of await edgesForGames(gameIds)) affected.set(key(k), k);

  const edges: MoveEdge[] = [];
  const keys = [...affected.values()];
  for (let i = 0; i < keys.length; i += 300) {
    const batch = keys.slice(i, i + 300);
    // Derived-condition pushdown lets MySQL filter the grouped view by its grouping columns.
    const [rows] = await connection.execute<EdgeRow[]>(
      `${EDGE_SELECT} WHERE (e.from_position_id, e.to_position_id, e.move_san) IN (${batch.map(() => "(?, ?, ?)").join(",")})`,
      batch.flatMap(k => [k.from_position_id, k.to_position_id, k.move_san]),
    );
    edges.push(...rows.map(toEdge));
  }
  const live = new Set(edges.map(key));
  const removed = keys.filter(k => !live.has(key(k)));

  await applyEdges(edges, removed);
  const ids = pending.map(r => Number(r.outbox_id));
  await connection.execute(
    `UPDATE graph_outbox SET processed_at = CURRENT_TIMESTAMP(3) WHERE outbox_id IN (${ids.map(() => "?").join(",")})`, ids,
  );
  return { processed: ids.length, games: gameIds.length, edges_upserted: edges.length, edges_removed: removed.length };
}

/** Full, idempotent rebuild of the graph from MySQL. Caller owns the MySQL transaction. */
export async function rebuildGraph(connection: Db) {
  // Lock the pending outbox first; edges are then read from a snapshot that includes them.
  const [pending] = await connection.execute<RowDataPacket[]>(
    "SELECT outbox_id FROM graph_outbox WHERE processed_at IS NULL FOR UPDATE",
  );
  const [rows] = await connection.execute<EdgeRow[]>(EDGE_SELECT);
  const start = await startPositionId(connection);
  await ensureGraphSchema();
  await clearGraph();
  if (start) await ensureStartNode(start);
  const edges = rows.map(toEdge);
  await applyEdges(edges, []);
  const ids = pending.map(r => Number(r.outbox_id));
  for (let i = 0; i < ids.length; i += 1000) {
    const batch = ids.slice(i, i + 1000);
    await connection.execute(
      `UPDATE graph_outbox SET processed_at = CURRENT_TIMESTAMP(3) WHERE outbox_id IN (${batch.map(() => "?").join(",")})`, batch,
    );
  }
  return { edges: edges.length, outbox_cleared: pending.length };
}
