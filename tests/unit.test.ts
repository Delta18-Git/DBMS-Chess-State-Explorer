import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
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

test("PATCH preserves omitted fields, validates boundaries and rejects extra keys", () => {
  assert.deepEqual(playerSchema.partial().parse({ rating: 1700 }), { rating: 1700 });
  assert.deepEqual(tournamentSchema.partial().parse({ name: "Updated" }), { name: "Updated" });
  assert.throws(() => playerSchema.parse({ name: "", rating: 3501 }));
  assert.throws(() => playerSchema.parse({ name: "X", role: "admin" }));
  assert.throws(() => tournamentSchema.parse({ name: "X", date: "2026-02-30" }));
  assert.throws(() => gameSchema.parse({ white_player_id: 1, black_player_id: 1, pgn: "1. e4 *" }));
  assert.throws(() => gameSchema.parse({ white_player_id: "1", black_player_id: 2, pgn: "1. e4 *" }));
  assert.throws(() => pagination(new Request("http://localhost/api/players?limit=0")));
  assert.deepEqual(pagination(new Request("http://localhost/api/players")), { limit: 25, offset: 0 });
});

test("passwords are salted, verified safely, and bearer tokens are stored as hashes", async () => {
  const password = "test-password-long-enough";
  const hash = await hashPassword(password);
  assert.notEqual(hash, await hashPassword(password));
  assert.ok(await verifyPassword(password, hash));
  assert.equal(await verifyPassword("incorrect", hash), false);
  assert.equal(await verifyPassword(password, "broken"), false);
  const token = newToken();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.notEqual(tokenHash(token), token);
});

test("JSON boundary enforces content type, size and safe errors", async () => {
  const request = (text: string, type = "application/json") => new Request("http://localhost", { method: "POST", headers: { "content-type": type }, body: text });
  assert.deepEqual(await body(request('{"hello":"world"}')), { hello: "world" });
  await assert.rejects(body(request("{")), SyntaxError);
  await assert.rejects(body(request("{}", "text/plain")), { status: 415 });
  await assert.rejects(body(request(JSON.stringify("x".repeat(131072)))), { status: 413 });
  const response = errorResponse({ code: "ER_DUP_ENTRY", sql: "secret password" });
  assert.equal(response.status, 409);
  assert.equal(JSON.stringify(await response.json()).includes("secret"), false);
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
      assert.match(handler, /connection\.release\(\)/, file);
      handlers++;
    }
  }
  assert.ok(handlers >= 40);
});
