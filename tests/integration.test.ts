import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID, scryptSync } from "node:crypto";
import mysql from "mysql2/promise";
import { Chess } from "chess.js";
import { dbOptions } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import { canonicalFen } from "../src/lib/chess";

test("real MySQL and Next.js HTTP integration", { timeout: 120000 }, async t => {
  assert.equal(process.env.INTEGRATION_TESTS, "1", "Opt in with INTEGRATION_TESTS=1; use an isolated database and server.");
  assert.match(process.env.DB_NAME ?? "", /_test$/, "DB_NAME must end in _test; never run against real data.");
  const sql = await mysql.createConnection({ ...dbOptions(), multipleStatements: true });
  const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
  const prefix = randomUUID().slice(0, 8);
  const password = "integration-password-123";
  const tracked: Record<string, number[]> = { player_id: [], tournament_id: [], opening_id: [], game_id: [], repertoire_id: [], evaluation_id: [], user_id: [] };
  const [originalPositions] = await sql.query<mysql.RowDataPacket[]>("SELECT position_id FROM `position`");
  const originalIds = new Set(originalPositions.map(p => p.position_id));
  const positionIds = new Set<number>();
  let admin = "", analyst = "";
  // JSON payload shapes are asserted below against the actual public HTTP contract.
  async function api(path: string, method = "GET", data?: unknown, token = admin): Promise<{ status: number; data: any; error?: any }> {
    const response = await fetch(`${base}/api${path}`, {
      method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const payload = await response.json();
    return { status: response.status, ...payload };
  }
  async function create(path: string, input: unknown, key: string) {
    const response = await api(path, "POST", input);
    assert.equal(response.status, 201, JSON.stringify(response));
    tracked[key].push(response.data[key]);
    return response.data;
  }
  async function counts() {
    const [rows] = await sql.query<mysql.RowDataPacket[]>(
      "SELECT (SELECT COUNT(*) FROM game) AS games, (SELECT COUNT(*) FROM ply) AS plies, (SELECT COUNT(*) FROM `position`) AS positions",
    );
    return { ...rows[0] };
  }
  let white: any, black: any, opening: any, tournament: any, gameA: any, gameB: any, detailA: any, detailB: any;
  try {
    for (const role of ["admin", "analyst", "locked"] as const) {
      const salt = "0123456789abcdef0123456789abcdef";
      const passwordHash = role === "analyst"
        ? `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`
        : await hashPassword(password);
      const [result] = await sql.execute<mysql.ResultSetHeader>(
        "INSERT INTO app_user (email, password_hash, role) VALUES (?, ?, ?)",
        [`${prefix}-${role}@example.com`, passwordHash, role === "admin" ? "admin" : "analyst"],
      );
      tracked.user_id.push(result.insertId);
    }
    await t.test("health, authentication, persistent lockout and role separation", async () => {
      assert.equal((await api("/health", "GET", undefined, "")).status, 200);
      assert.equal((await api("/players", "GET", undefined, "")).status, 401);
      assert.equal((await api("/auth/login", "POST", { email: `${prefix}-missing@example.com`, password })).status, 401);
      for (let i = 0; i < 5; i++) {
        assert.equal((await api("/auth/login", "POST", { email: `${prefix}-locked@example.com`, password: "wrong" })).status, 401);
      }
      assert.equal((await api("/auth/login", "POST", { email: `${prefix}-locked@example.com`, password })).status, 429);
      const login = await api("/auth/login", "POST", { email: `${prefix}-admin@example.com`, password });
      assert.equal(login.status, 200);
      admin = login.data.token;
      analyst = (await api("/auth/login", "POST", { email: `${prefix}-analyst@example.com`, password })).data.token;
      assert.equal((await api("/auth/me")).data.role, "admin");
      assert.equal((await api("/players", "GET", undefined, analyst)).status, 200);
      assert.equal((await api("/players", "POST", { name: "Forbidden" }, analyst)).status, 403);
      const [users] = await sql.execute<mysql.RowDataPacket[]>("SELECT password_hash FROM app_user WHERE user_id = ?", [tracked.user_id[0]]);
      assert.match(users[0].password_hash, /^scrypt-v2:/);
      const [upgraded] = await sql.execute<mysql.RowDataPacket[]>("SELECT password_hash FROM app_user WHERE user_id = ?", [tracked.user_id[1]]);
      assert.match(upgraded[0].password_hash, /^scrypt-v2:/, "Successful legacy login must upgrade its password hash");
      const [sessions] = await sql.execute<mysql.RowDataPacket[]>("SELECT token_hash FROM api_session WHERE user_id = ?", [tracked.user_id[0]]);
      assert.notEqual(sessions[0].token_hash, admin);
    });
    await t.test("expired lockouts reset the failure counter and successful login clears it", async () => {
      await sql.execute("UPDATE app_user SET locked_until = '2000-01-01', failed_attempts = 5 WHERE user_id = ?", [tracked.user_id[2]]);
      const email = `${prefix}-locked@example.com`;
      assert.equal((await api("/auth/login", "POST", { email, password: "wrong" })).status, 401);
      const [failed] = await sql.execute<mysql.RowDataPacket[]>("SELECT failed_attempts, locked_until FROM app_user WHERE user_id = ?", [tracked.user_id[2]]);
      assert.equal(failed[0].failed_attempts, 1);
      assert.equal(failed[0].locked_until, null);
      assert.equal((await api("/auth/login", "POST", { email, password })).status, 200);
      const [reset] = await sql.execute<mysql.RowDataPacket[]>("SELECT failed_attempts, locked_until FROM app_user WHERE user_id = ?", [tracked.user_id[2]]);
      assert.equal(reset[0].failed_attempts, 0);
      assert.equal(reset[0].locked_until, null);
    });
    await t.test("simultaneous logins for separate users do not conflict", async () => {
      for (let round = 0; round < 3; round++) {
        const results = await Promise.all(["admin", "analyst"].map(role =>
          api("/auth/login", "POST", { email: `${prefix}-${role}@example.com`, password }),
        ));
        for (const result of results) assert.equal(result.status, 200, JSON.stringify(result));
      }
    });
    await t.test("metadata CRUD, PATCH preservation, constraints and parameterized SQL", async () => {
      white = await create("/players", { name: `${prefix} White`, title: "GM", federation: "IND", rating: 2000 }, "player_id");
      black = await create("/players", { name: `${prefix} Black`, rating: 1900 }, "player_id");
      const patch = await api(`/players/${white.player_id}`, "PATCH", { rating: 2010 });
      assert.equal(patch.status, 200);
      assert.equal(patch.data.title, "GM");
      assert.equal(patch.data.federation, "IND");
      assert.equal((await api(`/players/${white.player_id}`, "PATCH", {})).status, 400);
      assert.equal((await api("/players", "POST", { name: "X", rating: 3501 })).status, 400);
      assert.equal((await api("/players", "POST", { name: "X", unknown: true })).status, 400);
      assert.equal((await api("/players/not-an-id")).status, 400);
      assert.equal((await api("/players/4294967295")).status, 404);
      assert.equal((await api("/players?limit=0")).status, 400);
      assert.equal((await api("/tournaments", "POST", { name: "Invalid date", date: "0001-01-01" })).status, 400);
      const injection = await create("/players", { name: "Robert'); DROP TABLE player; --" }, "player_id");
      assert.equal((await api(`/players/${injection.player_id}`)).data.name, injection.name);
      assert.equal((await api(`/players/${injection.player_id}`, "DELETE")).status, 200);
      tournament = await create("/tournaments", { name: `${prefix} Event`, date: "2026-01-01", location: "Bengaluru" }, "tournament_id");
      assert.equal((await api(`/tournaments/${tournament.tournament_id}`, "PATCH", { name: "Renamed" })).data.location, "Bengaluru");
      assert.equal((await api(`/tournaments/${tournament.tournament_id}`)).status, 200);
      opening = await create("/openings", { eco: "A05", name: `${prefix} Reti` }, "opening_id");
      assert.equal((await api("/openings", "POST", { eco: "A05", name: `${prefix} Reti` })).status, 409);
      assert.equal((await api(`/openings/${opening.opening_id}`, "PATCH", { name: `${prefix} Fianchetto` })).status, 200);
      assert.equal((await api(`/openings/${opening.opening_id}`)).status, 200);
      for (const path of ["/players", "/tournaments", "/openings"]) assert.equal((await api(`${path}?limit=1&offset=0`)).data.length, 1);
    });
    await t.test("atomic PGN ingestion, shared positions and ordered ply history", async () => {
      const input = { white_player_id: white.player_id, black_player_id: black.player_id, opening_id: opening.opening_id, tournament_id: tournament.tournament_id };
      gameA = await create("/games", { ...input, pgn: "1. Nf3 Nf6 2. g3 g6 3. Bg2 Bg7 1-0" }, "game_id");
      gameB = await create("/games", { ...input, pgn: "1. g3 g6 2. Nf3 Nf6 3. Bg2 Bg7 0-1" }, "game_id");
      detailA = (await api(`/games/${gameA.game_id}`)).data;
      detailB = (await api(`/games/${gameB.game_id}`)).data;
      for (const game of [detailA, detailB]) {
        assert.equal(game.plies.length, 6);
        game.plies.forEach((p: any, index: number) => {
          positionIds.add(p.from_position_id); positionIds.add(p.to_position_id);
          assert.equal(p.ply_no, index + 1);
          assert.equal(p.side, index % 2 === 0 ? "w" : "b");
          if (index) assert.equal(p.from_position_id, game.plies[index - 1].to_position_id);
        });
      }
      assert.equal(detailA.plies.at(-1).to_position_id, detailB.plies.at(-1).to_position_id);
      const before = await counts();
      const failed = await api("/games", "POST", { ...input, opening_id: 4294967295, pgn: "1. a4 h5 2. a5 h4 *" });
      assert.equal(failed.status, 422, JSON.stringify(failed));
      assert.deepEqual(await counts(), before, "New positions must roll back when the game FK fails");
      assert.equal((await api("/games", "POST", { ...input, pgn: "1. e5 *" })).status, 400);
      assert.deepEqual(await counts(), before);
      assert.equal((await api("/games", "POST", { ...input, pgn: "1. e5 *" }, "")).status, 401);
      assert.equal((await api("/games", "POST", { ...input, pgn: "1. e5 *" }, analyst)).status, 403);
      assert.equal((await api("/games", "POST", { ...input, pgn: `1. e4 {${"界".repeat(22000)}} e5 *` })).status, 400);
      assert.deepEqual(await counts(), before, "Rejected UTF-8 PGN must not create any positions or games");
      assert.equal((await api(`/games/${gameA.game_id}`, "PATCH", { date: "2026-02-01" })).status, 200);
      assert.equal((await api(`/games/${gameA.game_id}`, "PATCH", { result: "0-1" })).status, 400);
      assert.equal((await api(`/players/${white.player_id}`, "DELETE")).status, 409);
      assert.equal((await api(`/openings/${opening.opening_id}`, "DELETE")).status, 409);
      assert.equal((await api(`/tournaments/${tournament.tournament_id}`, "DELETE")).status, 409);
      const list = await api(`/games?player_id=${white.player_id}&opening_id=${opening.opening_id}`);
      assert.equal(list.data.length, 2);
    });
    await t.test("views, deterministic evaluation selection, triggers and stored-procedure analytics", async () => {
      const initial = detailA.plies[0].from_position_id;
      const afterWhite = detailA.plies[0].to_position_id;
      const afterBlack = detailA.plies[1].to_position_id;
      for (const [position_id, cp, depth] of [[initial, 100, 20], [afterWhite, -200, 20], [afterBlack, 100, 20], [afterWhite, -150, 10], [afterWhite, -250, 20]]) {
        await create("/evaluations", { position_id, cp, depth }, "evaluation_id");
      }
      assert.equal((await api(`/positions/${afterWhite}`)).data.cp, -250);
      for (const player of [white, black]) {
        const result = await api(`/analytics/players/${player.player_id}`);
        assert.equal(result.status, 200, JSON.stringify(result));
        assert.equal(Number(result.data.summary.games), 2);
        assert.equal(Number(result.data.summary.average_cp_loss), 350);
        assert.equal(Number(result.data.summary.blunders), 1);
        assert.equal(result.data.blunders.length, 1);
      }
      const nullEval = await create("/evaluations", { position_id: afterWhite, cp: null, depth: 21 }, "evaluation_id");
      const nullSummary = (await api(`/analytics/players/${white.player_id}`)).data.summary;
      assert.equal(nullSummary.average_cp_loss, null);
      assert.equal(Number(nullSummary.evaluated_plies), 0);
      assert.equal((await api(`/evaluations/${nullEval.evaluation_id}`, "DELETE")).status, 200);
      const audit = await api("/evaluations/audit?limit=100");
      assert.ok(audit.data.some((a: any) => a.evaluation_id === nullEval.evaluation_id && a.action === "DELETE"));
      assert.ok(audit.data.some((a: any) => a.evaluation_id === nullEval.evaluation_id && a.action === "INSERT"));
      const openingStats = (await api("/analytics/openings?min_games=2&limit=100")).data.find((o: any) => o.opening_id === opening.opening_id);
      assert.equal(Number(openingStats.white_win_pct), 50);
      assert.equal(Number(openingStats.games), 2);
      assert.equal((await api("/analytics/openings?min_games=0")).status, 400);
      const positionStats = await api(`/analytics/positions/${initial}`);
      assert.equal(Number(positionStats.data.usage.games), 2);
      assert.equal(positionStats.data.next_moves.length, 2);
      const finalStats = await api(`/analytics/positions/${detailA.plies.at(-1).to_position_id}`);
      assert.equal(Number(finalStats.data.usage.games), 2);
      assert.equal((await api(`/evaluations?position_id=${afterWhite}`)).status, 200);
    });
    await t.test("concurrent imports resolve shared position IDs with a current read", async () => {
      const input = { white_player_id: white.player_id, black_player_id: black.player_id, pgn: "1. h3 h6 2. a3 a6 *" };
      const results = await Promise.all([api("/games", "POST", input), api("/games", "POST", input)]);
      const finalPositions: number[] = [];
      for (let result of results) {
        if (result.status === 409) result = await api("/games", "POST", input);
        assert.equal(result.status, 201, JSON.stringify(result));
        tracked.game_id.push(result.data.game_id);
        const detail = (await api(`/games/${result.data.game_id}`)).data;
        for (const ply of detail.plies) { positionIds.add(ply.from_position_id); positionIds.add(ply.to_position_id); }
        finalPositions.push(detail.plies.at(-1).to_position_id);
      }
      assert.equal(finalPositions[0], finalPositions[1]);
    });
    await t.test("positions and repertoires enforce immutable nodes, legal SAN and explicit deletes", async () => {
      const initial = detailA.plies[0].from_position_id;
      assert.equal((await api(`/positions/${initial}`, "PATCH", { fen: "changed" })).status, 400);
      const target = detailA.plies.at(-1).to_position_id;
      assert.equal((await api(`/positions/${target}`, "PATCH", { comment: "Transposed position" })).status, 200);
      assert.equal((await api(`/positions/${target}`, "DELETE")).status, 409);
      const fenQuery = encodeURIComponent(detailA.plies.at(-1).to_fen.replace("0 1", "10 99"));
      assert.equal((await api(`/positions?fen=${fenQuery}`)).data[0].position_id, target);
      assert.equal((await api("/positions", "POST", { fen: detailA.plies.at(-1).to_fen })).status, 409);
      const board = new Chess(); board.move("h4"); board.move("a5");
      const standalone = await api("/positions", "POST", { fen: board.fen() });
      assert.equal(standalone.status, 201);
      positionIds.add(standalone.data.position_id);
      assert.equal(standalone.data.fen, canonicalFen(board.fen()));
      assert.equal((await api(`/positions/${standalone.data.position_id}`, "DELETE")).status, 200);
      const repertoire = await create("/repertoires", { player_id: white.player_id, name: `${prefix} White repertoire` }, "repertoire_id");
      const path = `/repertoires/${repertoire.repertoire_id}`;
      assert.equal((await api(path, "PATCH", { name: "Updated repertoire" })).status, 200);
      assert.equal((await api(`${path}/lines`, "POST", { start_position_id: initial, move_san: "e5" })).status, 400);
      const line = await api(`${path}/lines`, "POST", { start_position_id: initial, move_san: "e4" });
      assert.equal(line.status, 201);
      assert.equal((await api(`${path}/lines`, "POST", { start_position_id: initial, move_san: "e4" })).status, 409);
      assert.equal((await api(path)).data.lines.length, 1);
      assert.equal((await api(`/repertoires?player_id=${white.player_id}`)).data.length, 1);
      assert.equal((await api(`${path}/lines/${line.data.repertoire_line_id}`, "DELETE")).status, 200);
      assert.equal((await api(path, "DELETE")).status, 200);
      assert.equal((await api(path)).status, 404);
      assert.equal((await api(`/games/${gameA.game_id}`, "DELETE")).status, 200);
      assert.equal((await api(`/positions/${target}`)).status, 200, "Deleting one game must not delete shared positions");
      assert.equal((await api(`/games/${gameB.game_id}`)).data.plies.length, 6);
    });
    await t.test("multi-game PGN import, list totals, repertoire ownership and deviations, accounts", async () => {
      const header = (white: string, black: string, n: string, result: string) =>
        `[Event "${prefix} Club Open"]\n[Round "1.${n}"]\n[White "${prefix} ${white}"]\n[Black "${prefix} ${black}"]\n[Result "${result}"]\n` +
        `[WhiteElo "2100"]\n[BlackElo "2050"]\n[ECO "C20"]\n[Opening "${prefix} Test Opening"]\n[GameURL "https://lichess.org/broadcast/t/r/${prefix}${n}"]`;
      const pgn = [
        `${header("Alpha", "Beta", "1", "1-0")}\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0`,
        `${header("Alpha", "Gamma", "2", "1/2-1/2")}\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 1/2-1/2`,
        `${header("Alpha", "Beta", "3", "0-1")}\n\n1. e4 e5 2. Nf3 Nf6 0-1`,
      ].join("\n\n");
      assert.equal((await api("/import/pgn", "POST", { pgn }, analyst)).status, 403, "Imports are admin-only");
      const imported = await api("/import/pgn", "POST", { pgn });
      assert.equal(imported.status, 201, JSON.stringify(imported));
      assert.equal(imported.data.imported, 3);
      tracked.game_id.push(...imported.data.game_ids);
      tracked.tournament_id.push(imported.data.tournament_id);
      const again = await api("/import/pgn", "POST", { pgn });
      assert.equal(again.data.duplicates, 3, "game.source_url is UNIQUE: re-imports are skipped");
      const first = (await api(`/games/${imported.data.game_ids[0]}`)).data;
      for (const id of [first.white_player_id, first.black_player_id]) tracked.player_id.push(id);
      tracked.opening_id.push(first.opening_id);
      const third = (await api(`/games/${imported.data.game_ids[2]}`)).data;
      assert.equal(third.white_player_id, first.white_player_id, "Players are matched by name across games");
      assert.equal(third.black_player_id, first.black_player_id);
      const gamma = (await api(`/games/${imported.data.game_ids[1]}`)).data.black_player_id;
      tracked.player_id.push(gamma);
      for (const g of imported.data.game_ids) for (const p of (await api(`/games/${g}`)).data.plies) { positionIds.add(p.from_position_id); positionIds.add(p.to_position_id); }
      assert.equal(first.round, "1.1");
      assert.equal(first.white_elo, 2100);

      // Lists carry their full match count (COUNT(*) OVER ()) for numbered pagination.
      const page = await api(`/games?tournament_id=${imported.data.tournament_id}&limit=2`);
      assert.equal(page.data.length, 2);
      assert.equal(Number(page.data[0].total_rows), 3);
      assert.equal((await api(`/games?tournament_id=${imported.data.tournament_id}&result=0-1`)).data.length, 1);
      const standings = (await api(`/tournaments/${imported.data.tournament_id}`)).data.standings;
      const alpha = standings.find((s: any) => s.player_id === first.white_player_id);
      assert.equal(Number(alpha.points), 1.5);
      assert.equal(Number(alpha.place), 1);

      // Repertoires: built from the player's own games with INSERT … SELECT, then compared to them.
      const rep = await create("/repertoires", { player_id: first.white_player_id, name: `${prefix} Alpha White`, color: "w" }, "repertoire_id");
      const built = await api(`/repertoires/${rep.repertoire_id}/build`, "POST", { moves: 3, min_games: 1 });
      assert.equal(built.status, 201);
      const detail = (await api(`/repertoires/${rep.repertoire_id}`)).data;
      const afterNc6 = detail.lines.find((l: any) => l.move_san === "Bb5" || l.move_san === "Bc4");
      assert.ok(afterNc6, JSON.stringify(detail.lines));
      assert.equal(detail.deviations.length, 1, "One of the two games after 2…Nc6 left the prepared move");
      assert.equal((await api(`/repertoires/${rep.repertoire_id}`, "PATCH", { name: "Hijack" }, analyst)).status, 403, "Analysts cannot edit others' repertoires");
      const mine = await api("/repertoires", "POST", { player_id: first.white_player_id, name: `${prefix} analyst's`, color: "b" }, analyst);
      assert.equal(mine.status, 201, "Analysts may create their own repertoires");
      tracked.repertoire_id.push(mine.data.repertoire_id);
      assert.equal((await api(`/repertoires/${mine.data.repertoire_id}`, "PATCH", { name: `${prefix} renamed` }, analyst)).status, 200);

      // Accounts are managed by admins only; the last admin and one's own account are protected.
      assert.equal((await api("/users", "GET", undefined, analyst)).status, 403);
      const user = await api("/users", "POST", { email: `${prefix}-new@example.com`, display_name: "New Analyst", role: "analyst", password: "a-long-enough-password" });
      assert.equal(user.status, 201);
      tracked.user_id.push(user.data.user_id);
      assert.equal((await api("/users", "POST", { email: `${prefix}-short@example.com`, display_name: "X", role: "analyst", password: "short" })).status, 400);
      assert.equal((await api(`/users/${tracked.user_id[0]}`, "DELETE")).status, 409, "Admins cannot delete themselves");
      assert.equal((await api(`/users/${user.data.user_id}`, "DELETE")).status, 200);
    });
    await t.test("database-level checks and safe CREATE/ALTER/DROP demonstration", async () => {
      await assert.rejects(sql.execute("INSERT INTO player (name, rating) VALUES ('Invalid', 4000)"), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });
      await assert.rejects(sql.execute("INSERT INTO evaluation (position_id, cp, depth) VALUES (?, 0, 0)", [detailA.plies[0].from_position_id]), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });
      await sql.query(await readFile(new URL("../database/ddl-demo.sql", import.meta.url), "utf8"));
      const [indexes] = await sql.query<mysql.RowDataPacket[]>("SHOW INDEX FROM evaluation");
      assert.ok(indexes.some(i => i.Key_name === "idx_evaluation_position_depth"));
      assert.equal((await api(`/analytics/players/4294967295`)).status, 404);
    });
    await t.test("logout revokes tokens and expiration is enforced by MySQL", async () => {
      assert.equal((await api("/auth/logout", "POST", undefined, analyst)).status, 200);
      assert.equal((await api("/auth/me", "GET", undefined, analyst)).status, 401);
      await sql.execute("UPDATE api_session SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND) WHERE user_id = ?", [tracked.user_id[0]]);
      assert.equal((await api("/auth/me")).status, 401);
    });
  } finally {
    // Delete only fixtures created by this invocation; never truncate or reset a database.
    for (const gameId of tracked.game_id) {
      await sql.execute("DELETE FROM ply WHERE game_id = ?", [gameId]);
      await sql.execute("DELETE FROM game WHERE game_id = ?", [gameId]);
    }
    for (const repertoireId of tracked.repertoire_id) {
      await sql.execute("DELETE FROM repertoire_line WHERE repertoire_id = ?", [repertoireId]);
      await sql.execute("DELETE FROM repertoire WHERE repertoire_id = ?", [repertoireId]);
    }
    for (const evaluationId of tracked.evaluation_id) {
      await sql.execute("DELETE FROM evaluation WHERE evaluation_id = ?", [evaluationId]);
      await sql.execute("DELETE FROM evaluation_audit WHERE evaluation_id = ?", [evaluationId]);
    }
    for (const positionId of positionIds) {
      if (!originalIds.has(positionId)) await sql.execute("DELETE FROM `position` WHERE position_id = ?", [positionId]);
    }
    for (const [table, key] of [["player", "player_id"], ["tournament", "tournament_id"], ["opening", "opening_id"], ["app_user", "user_id"]]) {
      for (const value of tracked[key]) await sql.execute(`DELETE FROM ${table} WHERE ${key} = ?`, [value]);
    }
    await sql.end();
  }
});
