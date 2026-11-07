import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Chess } from "chess.js";

// Stockfish 19 ships with the app as the `stockfish` npm package (WebAssembly), so no system
// install is needed. Set STOCKFISH_PATH to a native binary to score faster; both speak UCI.

export interface EngineScore { fen: string; cp: number | null; mate: number | null; depth: number; best_move_san: string | null }

export function engineCommand(): { cmd: string; args: string[]; kind: "native" | "wasm" } {
  const native = process.env.STOCKFISH_PATH;
  if (native) return { cmd: native, args: [], kind: "native" };
  const wasm = join(process.cwd(), "node_modules", "stockfish", "bin", "stockfish-19-single.js");
  if (!existsSync(wasm)) throw new Error("Stockfish not found: run npm install (or set STOCKFISH_PATH)");
  return { cmd: process.execPath, args: [wasm], kind: "wasm" };
}

class UciEngine {
  private proc: ChildProcessWithoutNullStreams;
  private waiter: ((line: string) => boolean) | null = null;
  constructor() {
    const { cmd, args } = engineCommand();
    this.proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stderr.resume();
    createInterface({ input: this.proc.stdout }).on("line", line => { if (this.waiter?.(line)) this.waiter = null; });
  }
  private send(cmd: string) { this.proc.stdin.write(cmd + "\n"); }
  private until(done: (line: string) => boolean) {
    return new Promise<void>(resolve => { this.waiter = line => { if (done(line)) { resolve(); return true; } return false; }; });
  }
  async init() {
    const ready = this.until(l => l === "uciok"); this.send("uci"); await ready;
    this.send("setoption name Hash value 64");
    const ok = this.until(l => l === "readyok"); this.send("isready"); await ok;
  }
  /** Scores one board. cp/mate are from White's point of view. */
  async score(fen: string, depth: number): Promise<EngineScore> {
    let info = "";
    let best = "";
    const done = this.until(l => {
      if (l.startsWith("info") && / score (cp|mate) /.test(l) && / pv /.test(l)) info = l;
      if (l.startsWith("bestmove")) { best = l.split(" ")[1] ?? ""; return true; }
      return false;
    });
    this.send(`position fen ${fen}`);
    this.send(`go depth ${depth}`);
    await done;
    const m = /\bdepth (\d+) .*\bscore (cp|mate) (-?\d+)/.exec(info);
    const sign = fen.split(" ")[1] === "w" ? 1 : -1;
    let san: string | null = null;
    if (best && best !== "(none)") {
      try { san = new Chess(fen).move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] }).san; } catch { san = null; }
    }
    return {
      fen, depth: m ? Number(m[1]) : depth,
      cp: m && m[2] === "cp" ? Number(m[3]) * sign : null,
      mate: m && m[2] === "mate" ? Number(m[3]) * sign : null,
      best_move_san: san,
    };
  }
  quit() { try { this.send("quit"); } catch { /* already gone */ } this.proc.kill(); }
}

/** Scores many boards in parallel engine processes (finished games are skipped). */
export async function scorePositions(fens: string[], { depth = 14, workers = 4, onProgress }: { depth?: number; workers?: number; onProgress?: (done: number, total: number) => void } = {}) {
  const queue = fens.filter(fen => { try { return !new Chess(fen).isGameOver(); } catch { return false; } });
  const results: EngineScore[] = [];
  let next = 0;
  const pool = Array.from({ length: Math.max(1, Math.min(workers, queue.length)) }, async () => {
    const engine = new UciEngine();
    try {
      await engine.init();
      while (next < queue.length) {
        const fen = queue[next++];
        results.push(await engine.score(fen, depth));
        onProgress?.(results.length, queue.length);
      }
    } finally { engine.quit(); }
  });
  await Promise.all(pool);
  return results;
}
