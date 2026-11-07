import neo4j, { type Driver, type ManagedTransaction } from "neo4j-driver";
import { DEFAULT_POSITION } from "chess.js";
import { ApiError } from "./http";

// Neo4j holds a derived, rebuildable mirror of MySQL's position/ply tables:
//   (:Position {position_id, fen, side, is_start})-[:MOVE {san, games, white_wins, black_wins, draws, game_ids}]->(:Position)
// One MOVE edge per (from, to, SAN), aggregated over games, so variable-length path queries
// enumerate move ORDERS rather than one copy per game. MySQL stays the source of truth.

const globalGraph = globalThis as unknown as { chessGraph?: Driver };
export const START_FEN = DEFAULT_POSITION; // canonical start already ends in "0 1"

export function getGraph() {
  const { NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD } = process.env;
  if (!NEO4J_URI || !NEO4J_USER || !NEO4J_PASSWORD) throw new ApiError(503, "Graph database is not configured");
  globalGraph.chessGraph ??= neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD), {
    disableLosslessIntegers: true, connectionTimeout: 5000, maxConnectionPoolSize: 20,
  });
  return globalGraph.chessGraph;
}

export async function closeGraph() {
  await globalGraph.chessGraph?.close();
  globalGraph.chessGraph = undefined;
}

/** Run a read-only Cypher unit of work and always close the session. */
export async function readGraph<T>(work: (tx: ManagedTransaction) => Promise<T>) {
  const session = getGraph().session({ defaultAccessMode: neo4j.session.READ });
  try { return await session.executeRead(work); } finally { await session.close(); }
}

/** Run a write Cypher unit of work (single Neo4j transaction, retried on transient errors). */
export async function writeGraph<T>(work: (tx: ManagedTransaction) => Promise<T>) {
  const session = getGraph().session({ defaultAccessMode: neo4j.session.WRITE });
  try { return await session.executeWrite(work); } finally { await session.close(); }
}

// Uniqueness constraints double as the lookup indexes for position_id/FEN; the MOVE
// index supports "popular continuation" filters. All statements are idempotent.
export const GRAPH_SCHEMA = [
  "CREATE CONSTRAINT position_id_unique IF NOT EXISTS FOR (p:Position) REQUIRE p.position_id IS UNIQUE",
  "CREATE CONSTRAINT position_fen_unique IF NOT EXISTS FOR (p:Position) REQUIRE p.fen IS UNIQUE",
  "CREATE INDEX position_start IF NOT EXISTS FOR (p:Position) ON (p.is_start)",
  "CREATE INDEX move_games IF NOT EXISTS FOR ()-[m:MOVE]-() ON (m.games)",
];

export async function ensureGraphSchema() {
  const session = getGraph().session({ defaultAccessMode: neo4j.session.WRITE });
  try { for (const statement of GRAPH_SCHEMA) await session.run(statement); } finally { await session.close(); }
}

export interface MoveEdge {
  from_position_id: number; to_position_id: number; move_san: string;
  from_fen: string; to_fen: string;
  games: number; white_wins: number; black_wins: number; draws: number; game_ids: number[];
}
export interface EdgeKey { from_position_id: number; to_position_id: number; move_san: string }

const UPSERT_EDGES = `
UNWIND $edges AS e
MERGE (a:Position {position_id: e.from_position_id})
  ON CREATE SET a.fen = e.from_fen, a.side = split(e.from_fen, ' ')[1], a.is_start = (e.from_fen = $start)
MERGE (b:Position {position_id: e.to_position_id})
  ON CREATE SET b.fen = e.to_fen, b.side = split(e.to_fen, ' ')[1], b.is_start = (e.to_fen = $start)
MERGE (a)-[m:MOVE {san: e.move_san}]->(b)
SET m.games = e.games, m.white_wins = e.white_wins, m.black_wins = e.black_wins,
    m.draws = e.draws, m.game_ids = e.game_ids`;

const REMOVE_EDGES = `
UNWIND $keys AS k
MATCH (:Position {position_id: k.from_position_id})-[m:MOVE {san: k.move_san}]->(:Position {position_id: k.to_position_id})
DELETE m`;

// A node exists only while some MOVE touches it (plus the start board). Dropping orphans keeps
// FEN uniqueness safe if MySQL later deletes that unreferenced position and re-creates the
// board under a new position_id.
const REMOVE_ORPHANS = `
UNWIND $ids AS id
MATCH (p:Position {position_id: id})
WHERE NOT coalesce(p.is_start, false) AND NOT EXISTS { (p)-[:MOVE]-() }
DELETE p`;

/** JS numbers cross the Bolt wire as floats; ids, counts and SKIP/LIMIT must be Cypher integers. */
export const int = (value: number) => neo4j.int(value);
const intEdge = (e: MoveEdge) => ({
  ...e, from_position_id: int(e.from_position_id), to_position_id: int(e.to_position_id),
  games: int(e.games), white_wins: int(e.white_wins), black_wins: int(e.black_wins), draws: int(e.draws),
  game_ids: e.game_ids.map(int),
});
const intKey = (k: EdgeKey) => ({ ...k, from_position_id: int(k.from_position_id), to_position_id: int(k.to_position_id) });

function chunks<T>(items: T[], size = 1000) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Upserts recomputed edges, deletes edges that no longer exist in MySQL and their orphaned nodes, atomically. */
export async function applyEdges(edges: MoveEdge[], removed: EdgeKey[]) {
  await writeGraph(async tx => {
    for (const batch of chunks(edges)) await tx.run(UPSERT_EDGES, { edges: batch.map(intEdge), start: START_FEN });
    for (const batch of chunks(removed)) await tx.run(REMOVE_EDGES, { keys: batch.map(intKey) });
    const endpoints = [...new Set(removed.flatMap(k => [k.from_position_id, k.to_position_id]))];
    for (const batch of chunks(endpoints)) await tx.run(REMOVE_ORPHANS, { ids: batch.map(int) });
  });
}

/** Edge keys currently in the graph that reference any of the given games. */
export async function edgesForGames(gameIds: number[]) {
  if (!gameIds.length) return [] as EdgeKey[];
  return readGraph(async tx => {
    const result = await tx.run(
      `MATCH (a:Position)-[m:MOVE]->(b:Position) WHERE any(g IN m.game_ids WHERE g IN $ids)
       RETURN a.position_id AS from_position_id, b.position_id AS to_position_id, m.san AS move_san`,
      { ids: gameIds.map(int) },
    );
    return result.records.map(r => r.toObject() as EdgeKey);
  });
}

/** Deletes every Position/MOVE in batches (used only by full rebuild). */
export async function clearGraph() {
  const session = getGraph().session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    await session.run("MATCH (p:Position) CALL (p) { DETACH DELETE p } IN TRANSACTIONS OF 5000 ROWS");
  } finally { await session.close(); }
}

/** Ensures the start node exists even before any game is imported. */
export async function ensureStartNode(positionId: number) {
  await writeGraph(tx => tx.run(
    "MERGE (s:Position {position_id: $id}) ON CREATE SET s.fen = $fen, s.side = 'w', s.is_start = true",
    { id: int(positionId), fen: START_FEN },
  ));
}
