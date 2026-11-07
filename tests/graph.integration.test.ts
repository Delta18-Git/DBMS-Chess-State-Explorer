import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import neo4j from "neo4j-driver";
import { dbOptions } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";

// Real MySQL + real Neo4j + compiled Next.js server. Requires an isolated *_test MySQL database
// AND a Neo4j instance used for nothing else (Community edition has one database; the
// rebuild step below wipes it). Opt in with INTEGRATION_TESTS=1 and NEO4J_TEST_OK=1.
test("Neo4j mirror, outbox relay, graph queries and full-text search", { timeout: 180000 }, async t => {
  assert.equal(process.env.INTEGRATION_TESTS, "1", "Opt in with INTEGRATION_TESTS=1");
  assert.match(process.env.DB_NAME ?? "", /_test$/, "DB_NAME must end in _test");
  assert.equal(process.env.NEO4J_TEST_OK, "1", "Set NEO4J_TEST_OK=1 only when NEO4J_URI points at a disposable test graph");
  const sql = await mysql.createConnection(dbOptions());
  const graph = neo4j.driver(process.env.NEO4J_URI!, neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!), { disableLosslessIntegers: true });
  const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
  const prefix = `g${randomUUID().slice(0, 6)}`;
  const password = "integration-password-123";
  const users: number[] = [], games: number[] = [], players: number[] = [];
  let admin = "", analyst = "";

  async function api(path: string, method = "GET", data?: unknown, token = admin): Promise<{ status: number; data: any; error?: any }> {
    const response = await fetch(`${base}/api${path}`, {
      method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, ...(await response.json()) };
  }
  async function cypher(query: string, params: Record<string, unknown> = {}) {
    const session = graph.session();
    try { return (await session.run(query, params)).records.map(r => r.toObject()); } finally { await session.close(); }
  }
  const pending = async (gameId: number) => {
    const [rows] = await sql.execute<mysql.RowDataPacket[]>("SELECT action FROM graph_outbox WHERE game_id = ? AND processed_at IS NULL ORDER BY outbox_id", [gameId]);
    return rows.map(r => r.action);
  };
  const edgeCount = async () => (await cypher("MATCH ()-[m:MOVE]->() RETURN count(m) AS n"))[0].n as number;

  try {
    for (const role of ["admin", "analyst"] as const) {
      const [r] = await sql.execute<mysql.ResultSetHeader>("INSERT INTO app_user (email, password_hash, role) VALUES (?, ?, ?)",
        [`${prefix}-${role}@example.com`, await hashPassword(password), role]);
      users.push(r.insertId);
    }
    admin = (await api("/auth/login", "POST", { email: `${prefix}-admin@example.com`, password }, "")).data.token;
    analyst = (await api("/auth/login", "POST", { email: `${prefix}-analyst@example.com`, password }, "")).data.token;
    // Start from a graph that mirrors MySQL exactly.
    assert.equal((await api("/graph/sync?mode=rebuild", "POST")).status, 200);

    const white = (await api("/players", "POST", { name: `${prefix} Kasparovich` })).data.player_id;
    const black = (await api("/players", "POST", { name: `${prefix} Karpovsky` })).data.player_id;
    players.push(white, black);
    const importGame = async (pgn: string) => {
      const r = await api("/games", "POST", { white_player_id: white, black_player_id: black, pgn });
      assert.equal(r.status, 201, JSON.stringify(r));
      games.push(r.data.game_id);
      return r.data.game_id as number;
    };

    let gA = 0, gB = 0, gC = 0, target = 0;
    await t.test("game insert writes an outbox row in the same transaction; a rolled-back import writes none", async () => {
      // A unique opening sequence so these assertions do not depend on other data in the database.
      gA = await importGame("1. a3 h6 2. Nf3 a6 3. b3 h5 1-0");
      assert.deepEqual(await pending(gA), ["UPSERT"]);
      const [[before]] = await sql.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM graph_outbox");
      const failed = await api("/games", "POST", { white_player_id: white, black_player_id: black, opening_id: 4294967295, pgn: "1. a3 h6 *" });
      assert.equal(failed.status, 422);
      const [[after]] = await sql.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM graph_outbox");
      assert.equal(after.n, before.n, "Trigger output must roll back with the failed import");
    });

    await t.test("pending changes are visible, analysts cannot sync, admins drain idempotently", async () => {
      const stats = await api("/graph/stats", "GET", undefined, analyst);
      assert.equal(stats.status, 200);
      assert.ok(Number(stats.data.mysql.pending_changes) >= 1);
      assert.equal((await api("/graph/sync", "POST", undefined, analyst)).status, 403);
      const novelty = await api(`/graph/games/${gA}/novelty`, "GET", undefined, analyst);
      assert.equal(novelty.data.synced, false, "Unsynced games are reported as such, not guessed");
      const drained = await api("/graph/sync", "POST");
      assert.equal(drained.status, 200, JSON.stringify(drained));
      assert.ok(drained.data.processed >= 1);
      assert.deepEqual(await pending(gA), []);
      const again = await api("/graph/sync", "POST");
      assert.equal(again.data.processed, 0, "Nothing left to replay");
      const edges = await cypher("MATCH ()-[m:MOVE]->() WHERE $g IN m.game_ids RETURN m.san AS san, m.games AS games", { g: neo4j.int(gA) });
      assert.equal(edges.length, 6);
      assert.ok(edges.every(e => e.games === 1));
    });

    await t.test("a transposition is found as two move orders, each attributed to the game that played it", async () => {
      gB = await importGame("1. Nf3 h6 2. a3 a6 3. b3 h5 0-1"); // same final board as gA, different order
      assert.equal((await api("/graph/sync", "POST")).status, 200);
      const detailA = (await api(`/games/${gA}`)).data, detailB = (await api(`/games/${gB}`)).data;
      target = detailA.plies.at(-1).to_position_id;
      assert.equal(detailB.plies.at(-1).to_position_id, target, "MySQL deduplicates the shared board");
      // The boards diverge after ply 1 and re-merge after ply 3 (…a6 / …a6 from different boards).
      const merge = detailA.plies[2].to_position_id;
      assert.equal(detailB.plies[2].to_position_id, merge);
      const list = await api("/graph/transpositions?limit=100", "GET", undefined, analyst);
      assert.ok(list.data.some((r: any) => r.position_id === merge && r.routes >= 2), JSON.stringify(list.data.slice(0, 3)));
      const paths = await api(`/graph/positions/${target}/paths`, "GET", undefined, analyst);
      assert.equal(paths.status, 200);
      assert.equal(paths.data.is_transposition, true);
      const orders = paths.data.paths.map((p: any) => `${p.moves.join(" ")}|${p.played_by.join(",")}`).sort();
      assert.deepEqual(orders, [`Nf3 h6 a3 a6 b3 h5|${gB}`, `a3 h6 Nf3 a6 b3 h5|${gA}`].sort());
      assert.ok(paths.data.paths.every((p: any) => p.depth === 6));
    });

    await t.test("the opening tree aggregates games per edge and respects min_games", async () => {
      const merge = (await api(`/games/${gA}`)).data.plies[2].to_position_id;
      const tree = await api(`/graph/positions/${merge}/tree?depth=2`, "GET", undefined, analyst);
      assert.equal(tree.status, 200);
      const a6 = tree.data.edges.find((e: any) => e.san === "a6");
      assert.equal(a6.games, 2, "Both games played …a6 from the merged board: one aggregated edge");
      const pruned = await api(`/graph/positions/${merge}/tree?depth=2&min_games=3`, "GET", undefined, analyst);
      assert.equal(pruned.data.edges.length, 0);
      assert.equal((await api(`/graph/positions/${merge}/tree?depth=9`)).status, 400, "Traversal depth is bounded");
    });

    await t.test("novelty: the first move no other stored game played from that board", async () => {
      gC = await importGame("1. a3 h6 2. Nf3 a6 3. c3 *"); // follows gA for 4 plies, then deviates
      await api("/graph/sync", "POST");
      const n = await api(`/graph/games/${gC}/novelty`, "GET", undefined, analyst);
      assert.equal(n.data.synced, true);
      assert.equal(n.data.novelty.ply_no, 5);
      assert.equal(n.data.novelty.san, "c3");
      assert.equal(n.data.novelty.book_plies, 4);
      assert.deepEqual(n.data.novelty.reference_games, [gA]);
      assert.deepEqual(n.data.novelty.alternatives.map((a: any) => a.san), ["b3"]);
    });

    await t.test("deleting a game propagates through the DELETE trigger and removes orphaned nodes", async () => {
      const before = await edgeCount();
      assert.equal((await api(`/games/${gC}`, "DELETE")).status, 200);
      games.splice(games.indexOf(gC), 1);
      assert.deepEqual(await pending(gC), ["DELETE"]);
      const r = await api("/graph/sync", "POST");
      assert.ok(r.data.edges_removed >= 1);
      assert.equal(await edgeCount(), before - 1, "Only the c3 edge was unique to the deleted game");
      const left = await cypher("MATCH ()-[m:MOVE]->() WHERE $g IN m.game_ids RETURN count(m) AS n", { g: neo4j.int(gC) });
      assert.equal(left[0].n, 0);
      const orphans = await cypher("MATCH (p:Position) WHERE NOT coalesce(p.is_start, false) AND NOT EXISTS { (p)-[:MOVE]-() } RETURN count(p) AS n");
      assert.equal(orphans[0].n, 0);
    });

    await t.test("full rebuild reproduces exactly the incrementally synced graph and matches v_move_edge", async () => {
      const incremental = await cypher("MATCH (a)-[m:MOVE]->(b) RETURN a.position_id AS a, b.position_id AS b, m.san AS san, m.games AS games ORDER BY a, b, san");
      const rebuilt = await api("/graph/sync?mode=rebuild", "POST");
      assert.equal(rebuilt.status, 200);
      const after = await cypher("MATCH (a)-[m:MOVE]->(b) RETURN a.position_id AS a, b.position_id AS b, m.san AS san, m.games AS games ORDER BY a, b, san");
      assert.deepEqual(after, incremental);
      const [[view]] = await sql.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM v_move_edge");
      assert.equal(after.length, Number(view.n));
    });

    await t.test("FULLTEXT search ranks prefix matches and strips boolean operators", async () => {
      const s = await api(`/search?q=${encodeURIComponent(`${prefix} Kasp`)}&type=player`, "GET", undefined, analyst);
      assert.equal(s.status, 200, JSON.stringify(s));
      assert.equal(s.data.players[0].player_id, white);
      const hostile = await api(`/search?q=${encodeURIComponent('Karpovsky" -(>~*')}`, "GET", undefined, analyst);
      assert.equal(hostile.status, 200);
      assert.equal(hostile.data.query, "+Karpovsky*");
      assert.equal((await api("/search?q=%20", "GET", undefined, analyst)).status, 400);
      const ov = await api("/analytics/overview", "GET", undefined, analyst);
      assert.equal(ov.status, 200);
      assert.ok(Number(ov.data.counts.games) >= 2);
    });
  } finally {
    for (const g of games) await api(`/games/${g}`, "DELETE");
    if (admin) await api("/graph/sync", "POST");
    for (const p of players) await sql.execute("DELETE FROM player WHERE player_id = ?", [p]);
    for (const u of users) await sql.execute("DELETE FROM app_user WHERE user_id = ?", [u]);
    await sql.end();
    await graph.close();
  }
});
