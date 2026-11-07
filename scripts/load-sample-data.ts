import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Chess } from "chess.js";

// Loads data/sample_games.pgn through the REAL HTTP API (login, metadata, PGN import),
// then scores every distinct position with Stockfish and POSTs the evaluations.
// Requires a running server and an admin account:
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run data:load [-- --depth 14 --file data/x.pgn]
//   ... npm run data:load -- --evaluate-only   (only score positions not yet evaluated; resumable)
// PGN comments are stripped. Mate scores are stored as NULL cp (non-centipawn), finished boards are not scored.

const base = (process.env.API_BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "") + "/api";
const arg = (flag: string, fallback: string) => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const depth = Number(arg("--depth", "14"));
const file = arg("--file", "data/sample_games.pgn");
let token = "";

async function api<T = any>(path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const payload = await response.json() as { data?: T; error?: { message: string } };
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${payload.error?.message}`);
  return payload.data as T;
}

async function all<T>(path: string) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await api<T[]>(`${path}${path.includes("?") ? "&" : "?"}limit=100&offset=${offset}`);
    rows.push(...page);
    if (page.length < 100) return rows;
  }
}

function headers(pgn: string) {
  const h: Record<string, string> = {};
  for (const m of pgn.matchAll(/^\[(\w+) "([^"]*)"\]$/gm)) h[m[1]] = m[2];
  return h;
}

class Engine {
  private proc = spawn(process.env.STOCKFISH_PATH ?? "stockfish", [], { stdio: ["pipe", "pipe", "inherit"] });
  private lines = createInterface({ input: this.proc.stdout! });
  private waiters: Array<(line: string) => boolean> = [];
  constructor() { this.lines.on("line", line => { this.waiters = this.waiters.filter(w => !w(line)); }); }
  private send(cmd: string) { this.proc.stdin!.write(cmd + "\n"); }
  private until(match: (line: string) => boolean, collect?: (line: string) => void) {
    return new Promise<void>(resolve => this.waiters.push(line => { collect?.(line); if (match(line)) { resolve(); return true; } return false; }));
  }
  async init() {
    this.send("uci"); await this.until(l => l === "uciok");
    this.send("setoption name Threads value 4"); this.send("setoption name Hash value 128");
    this.send("isready"); await this.until(l => l === "readyok");
  }
  /** White-relative centipawns, or null for a mate score. */
  async score(fen: string, depth: number) {
    let last = "";
    // movetime caps rare runaway searches; the depth actually reached is what gets stored.
    this.send(`position fen ${fen}`); this.send(`go depth ${depth} movetime 5000`);
    await this.until(l => l.startsWith("bestmove"), l => { if (/^info .*\bscore (cp|mate) /.test(l)) last = l; });
    const m = /\bdepth (\d+) .*\bscore (cp|mate) (-?\d+)/.exec(last);
    if (!m) return null;
    const sign = fen.split(" ")[1] === "w" ? 1 : -1;
    return { depth: Number(m[1]), cp: m[2] === "mate" ? null : Number(m[3]) * sign };
  }
  quit() { this.send("quit"); }
}

async function main() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (an admin account)");
  token = (await api<{ token: string }>("/auth/login", "POST", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).token;

  const evaluateOnly = process.argv.includes("--evaluate-only");
  const existing = await api<unknown[]>("/games?limit=1");
  if (!evaluateOnly && existing.length && !process.argv.includes("--force")) throw new Error("Games already exist; pass --force to import duplicates anyway");

  const text = await readFile(file, "utf8");
  // Lichess exports stack several {comments} per move ([%eval], [%clk], annotations), which
  // chess.js's strict parser rejects; comments carry no move data, so drop them before import.
  const pgns = text.split(/\n\s*\n(?=\[Event )/).map(s => s.trim().replace(/\s*\{[^}]*\}/g, "")).filter(Boolean);
  const players = new Map((await all<any>("/players")).map(p => [p.name, p.player_id as number]));
  const tournaments = new Map((await all<any>("/tournaments")).map(t => [t.name, t.tournament_id as number]));
  const openings = new Map((await all<any>("/openings")).map(o => [`${o.eco}|${o.name}`, o.opening_id as number]));
  const date = (d?: string) => d && /^\d{4}\.\d{2}\.\d{2}$/.test(d) ? d.replaceAll(".", "-") : null;

  async function player(name: string, title?: string, elo?: string) {
    if (!players.has(name)) {
      const rating = Number(elo);
      const created = await api("/players", "POST", {
        name, title: title || null, rating: Number.isInteger(rating) && rating > 0 ? rating : null,
      });
      players.set(name, created.player_id);
    }
    return players.get(name)!;
  }

  const gameIds: number[] = evaluateOnly ? (await all<any>("/games")).map(g => g.game_id as number) : [];
  for (const pgn of evaluateOnly ? [] : pgns) {
    const h = headers(pgn);
    const white = await player(h.White, h.WhiteTitle, h.WhiteElo);
    const black = await player(h.Black, h.BlackTitle, h.BlackElo);
    const event = h.BroadcastName ?? h.Event;
    if (event && !tournaments.has(event)) {
      tournaments.set(event, (await api("/tournaments", "POST", { name: event.slice(0, 150), date: date(h.Date), location: null })).tournament_id);
    }
    const okey = `${h.ECO}|${h.Opening}`;
    if (/^[A-E]\d{2}$/.test(h.ECO ?? "") && h.Opening && !openings.has(okey)) {
      openings.set(okey, (await api("/openings", "POST", { eco: h.ECO, name: h.Opening.slice(0, 150) })).opening_id);
    }
    try {
      const game = await api("/games", "POST", {
        white_player_id: white, black_player_id: black,
        tournament_id: event ? tournaments.get(event) : null, opening_id: openings.get(okey) ?? null,
        date: date(h.Date), pgn,
      });
      gameIds.push(game.game_id);
      console.log(`game ${game.game_id}: ${h.White} - ${h.Black} ${game.result} (${game.plies} plies)`);
    } catch (error) { console.warn(`skipped ${h.White} - ${h.Black}: ${(error as Error).message}`); }
  }

  // Distinct boards across the imported games, skipping already-evaluated and finished ones.
  const fens = new Map<number, string>();
  for (const gid of gameIds) {
    const detail = await api(`/games/${gid}`);
    for (const p of detail.plies) { fens.set(p.from_position_id, p.from_fen); fens.set(p.to_position_id, p.to_fen); }
  }
  const engine = new Engine();
  await engine.init();
  let scored = 0;
  try {
    for (const [position_id, fen] of fens) {
      const pos = await api(`/positions/${position_id}`);
      if (pos.evaluation_id) continue;
      if (new Chess(fen).isGameOver()) continue;
      const s = await engine.score(fen, depth);
      if (!s) continue;
      await api("/evaluations", "POST", { position_id, cp: s.cp, depth: s.depth });
      if (++scored % 250 === 0) console.log(`  evaluated ${scored}/${fens.size} positions`);
    }
  } finally { engine.quit(); }
  console.log(`${evaluateOnly ? "Scanned" : "Imported"} ${gameIds.length}${evaluateOnly ? "" : `/${pgns.length}`} games; ${fens.size} distinct positions; ${scored} new evaluations at depth ${depth}.`);
  await api("/auth/logout", "POST");
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
