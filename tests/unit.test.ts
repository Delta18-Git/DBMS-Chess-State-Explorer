import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { scryptSync } from "node:crypto";
import type { Pool } from "mysql2/promise";
import { Chess, DEFAULT_POSITION } from "chess.js";
import { canonicalFen, legalSan, parseGame } from "../src/lib/chess";
import { hashPassword, newToken, tokenHash, verifyPassword } from "../src/lib/auth";
import { ApiError, body, errorResponse, pagination } from "../src/lib/http";
import { gameSchema, playerSchema, tournamentSchema } from "../src/lib/validation";

test("canonical FEN is case sensitive, ignores clocks and irrelevant en-passant targets", () => {
  assert.equal(canonicalFen(DEFAULT_POSITION.replace("0 1", "14 21")), DEFAULT_POSITION);
  const board = new Chess();
  board.move("e4");
  assert.equal(canonicalFen(board.fen({ forceEnpassantSquare: true })), canonicalFen(board.fen()));
  assert.notEqual(canonicalFen(DEFAULT_POSITION), canonicalFen(DEFAULT_POSITION.replace(" w ", " b ")));
  assert.notEqual(canonicalFen(DEFAULT_POSITION), canonicalFen(DEFAULT_POSITION.replace("KQkq", "KQ")));
  const capture = new Chess();
  for (const move of ["e4", "a6", "e5", "d5"]) capture.move(move);
  assert.notEqual(canonicalFen(capture.fen()), canonicalFen(capture.fen().replace(" d6 ", " - ")));
  assert.throws(() => canonicalFen("not a fen"), ApiError);
});

test("transposing move orders share the same canonical board", () => {
  const a = parseGame("1. Nf3 Nf6 2. g3 g6 3. Bg2 Bg7 *");
  const b = parseGame("1. g3 g6 2. Nf3 Nf6 3. Bg2 Bg7 *");
  assert.equal(canonicalFen(a.moves.at(-1)!.after), canonicalFen(b.moves.at(-1)!.after));
  assert.equal(a.moves.length, 6);
  assert.equal(a.moves[0].san, "Nf3");
});

test("PGN import rejects illegal moves, variants, custom starts and contradictory results", () => {
  assert.throws(() => parseGame("1. e5 *"), ApiError);
  assert.throws(() => parseGame("*"), ApiError);
  assert.throws(() => parseGame('[Variant "Chess960"]\n\n1. e4 *'), ApiError);
  assert.throws(() => parseGame('[SetUp "1"]\n[FEN "8/8/8/8/8/8/4K3/7k w - - 0 1"]\n\n1. Kf3 *'), ApiError);
  assert.throws(() => parseGame("1. e4 e5 1-0", "0-1"), ApiError);
  assert.throws(() => parseGame("1. f3 e5 2. g4 Qh4# 1-0"), ApiError);
  const mate = parseGame("1. f3 e5 2. g4 Qh4# 0-1");
  assert.equal(mate.result, "0-1");
  assert.match(parseGame("1. e4 e5 *", "1-0").pgn, /1-0/);
});

test("repertoire moves are validated against their actual starting position", () => {
  assert.equal(legalSan(DEFAULT_POSITION, "e4"), "e4");
  assert.throws(() => legalSan(DEFAULT_POSITION, "e5"), ApiError);
});

test("a legal standard-start game ending with insufficient material cannot be decisive", () => {
  const pgn = `1. e3 b5 2. Bxb5 Na6 3. Bxa6 Bxa6 4. Qf3 Bc4 5. Qxa8 Bxa2 6. Rxa2 Qxa8
7. Rxa7 Qxa7 8. g4 Qxe3+ 9. dxe3 f5 10. gxf5 Kd8 11. Nc3 c5 12. b3 h6 13. h3 Kc8
14. Nf3 d5 15. Nxd5 Kb8 16. Nxe7 Nxe7 17. c4 Nxf5 18. Kd1 Nxe3+ 19. fxe3 Ka7
20. b4 cxb4 21. Rf1 b3 22. Ke1 g5 23. Nxg5 hxg5 24. Rxf8 Rxf8 25. Kd1 Rf3
26. Kd2 Rxe3 27. Kxe3 g4 28. hxg4 b2 29. Bxb2 Ka6 30. Bh8 Kb7 31. Bg7 Ka7
32. Kf2 Ka6 33. Kg1 Ka5 34. Kh1 Kb6 35. Bh6 Ka6 36. Bc1 Kb7 37. Bd2 Kc7
38. Bc3 Kc6 39. Bh8 Kb6 40. Ba1 Ka5 41. c5 Ka4 42. Kh2 Ka5 43. Kh1 Ka4
44. Bf6 Kb4 45. Bg5 Kxc5 46. Be3+ Kb5 47. g5 Kb4 48. Bf2 Kc4 49. g6 Kd5
50. Be1 Kd4 51. Kg1 Kd3 52. Bh4 Kd4 53. Kf1 Ke4 54. Bf6 Kf3 55. Bg7 Kg4
56. Ba1 Kg5 57. Ke2 Kxg6 1/2-1/2`;
  assert.equal(parseGame(pgn).result, "1/2-1/2");
  assert.throws(() => parseGame(pgn.replace("1/2-1/2", "1-0")), { message: "Result conflicts with insufficient mating material" });
});

test("PATCH preserves omitted fields, validates boundaries and rejects extra keys", () => {
  assert.deepEqual(playerSchema.partial().parse({ rating: 1700 }), { rating: 1700 });
  assert.deepEqual(tournamentSchema.partial().parse({ name: "Updated" }), { name: "Updated" });
  assert.throws(() => playerSchema.parse({ name: "", rating: 3501 }));
  assert.throws(() => playerSchema.parse({ name: "X", role: "admin" }));
  assert.throws(() => tournamentSchema.parse({ name: "X", date: "2026-02-30" }));
  assert.throws(() => tournamentSchema.parse({ name: "X", date: "0001-01-01" }));
  assert.equal(tournamentSchema.parse({ name: "X", date: "1000-01-01" }).date, "1000-01-01");
  assert.throws(() => gameSchema.parse({ white_player_id: 1, black_player_id: 1, pgn: "1. e4 *" }));
  assert.throws(() => gameSchema.parse({ white_player_id: "1", black_player_id: 2, pgn: "1. e4 *" }));
  assert.throws(() => pagination(new Request("http://localhost/api/players?limit=0")));
  assert.deepEqual(pagination(new Request("http://localhost/api/players")), { limit: 25, offset: 0 });
});

test("passwords are salted, verified safely, and bearer tokens are stored as hashes", async () => {
  const password = "test-password-long-enough";
  const hash = await hashPassword(password);
  assert.match(hash, /^scrypt-v2:/);
  assert.notEqual(hash, await hashPassword(password));
  assert.ok(await verifyPassword(password, hash));
  assert.equal(await verifyPassword("incorrect", hash), false);
  assert.equal(await verifyPassword(password, "broken"), false);
  assert.equal(await verifyPassword(password, `${hash}:extra`), false);
  const salt = "0123456789abcdef0123456789abcdef";
  const legacy = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  assert.ok(await verifyPassword(password, legacy), "Existing accounts must remain usable");
  assert.equal(await verifyPassword("wrong", legacy), false);
  const token = newToken();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.notEqual(tokenHash(token), token);
});

test("JSON boundary enforces content type, size and safe errors", async () => {
  const request = (text: string, type = "application/json") => new Request("http://localhost", { method: "POST", headers: { "content-type": type }, body: text });
  assert.deepEqual(await body(request('{"hello":"world"}')), { hello: "world" });
  await assert.rejects(body(request("{")), SyntaxError);
  await assert.rejects(body(request("{}", "text/plain")), { status: 415 });
  await assert.rejects(body(request("{}", "application/json-bogus")), { status: 415 });
  assert.deepEqual(await body(request("{}", "application/json; charset=utf-8")), {});
  await assert.rejects(body(new Request("http://localhost", {
    method: "POST", headers: { "content-type": "application/json" },
    body: Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]),
  })), { status: 400 });
  await assert.rejects(body(request(JSON.stringify("x".repeat(131072)))), { status: 413 });
  const response = errorResponse({ code: "ER_DUP_ENTRY", sql: "secret password" });
  assert.equal(response.status, 409);
  assert.equal(JSON.stringify(await response.json()).includes("secret"), false);
});

test("PGN byte limit accounts for multibyte comments and normalized headers", () => {
  assert.throws(() => parseGame(`1. e4 {${"界".repeat(22000)}} e5 *`), { status: 400 });
  const result = parseGame(`1. e4 {${"界".repeat(20000)}} e5 *`);
  assert.ok(Buffer.byteLength(result.pgn, "utf8") < 65536);
});

test("each route handler owns its transaction, commit, rollback and connection release", async () => {
  const files = await readdir(new URL("../src/app/api/", import.meta.url), { recursive: true });
  let handlers = 0;
  for (const file of files.filter(f => f.endsWith("route.ts"))) {
    const source = await readFile(new URL(`../src/app/api/${file}`, import.meta.url), "utf8");
    for (const handler of source.split(/export async function /).slice(1)) {
      assert.match(handler, /beginTransaction\(\)|START TRANSACTION READ ONLY/, file);
      assert.match(handler, /connection\.commit\(\)/, file);
      assert.match(handler, /connection\.rollback\(\)/, file);
      assert.match(handler, /connection\?\.release\(\)/, file);
      assert.ok(handler.indexOf("try {") < handler.indexOf("await getPool().getConnection()"), file);
      handlers++;
    }
  }
  assert.ok(handlers >= 40);
});

test("every handler returns safe JSON when connection acquisition fails", async () => {
  const globalDb = globalThis as unknown as { chessPool?: Pool };
  const previous = globalDb.chessPool;
  globalDb.chessPool = { getConnection: async () => { throw { code: "ECONNREFUSED", sql: "secret" }; } } as unknown as Pool;
  try {
    const files = await readdir(new URL("../src/app/api/", import.meta.url), { recursive: true });
    let checked = 0;
    for (const file of files.filter(f => f.endsWith("route.ts"))) {
      const route = await import(new URL(`../src/app/api/${file}`, import.meta.url).href);
      for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
        if (typeof route[method] !== "function") continue;
        const response: Response = await route[method](new Request("http://localhost/api", { method }), {
          params: Promise.resolve({ id: "1", lineId: "1" }),
        });
        assert.equal(response.status, 503, `${method} ${file}`);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(JSON.stringify(await response.json()).includes("secret"), false);
        checked++;
      }
    }
    assert.ok(checked >= 40);
  } finally { globalDb.chessPool = previous; }
});

test("failed rollback destroys the connection without masking the original error", async () => {
  const globalDb = globalThis as unknown as { chessPool?: Pool };
  const previous = globalDb.chessPool;
  let destroyed = false, released = false;
  globalDb.chessPool = { getConnection: async () => ({
    query: async () => { throw { code: "ER_DUP_ENTRY" }; },
    rollback: async () => { throw new Error("Connection lost during rollback"); },
    destroy: () => { destroyed = true; }, release: () => { released = true; },
  }) } as unknown as Pool;
  try {
    const { GET } = await import("../src/app/api/players/route");
    const response = await GET(new Request("http://localhost/api/players"));
    assert.equal(response.status, 409);
    assert.ok(destroyed);
    assert.ok(released);
  } finally { globalDb.chessPool = previous; }
});
