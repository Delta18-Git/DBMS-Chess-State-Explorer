"use client";

import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";

// Live Stockfish 19 in the browser (WebAssembly in a Web Worker, served from /engine/).
// Scores are converted to White's point of view; principal variations are converted to SAN.

export interface EngineLine { multipv: number; depth: number; cp: number | null; mate: number | null; pv: string[]; uci: string[] }
export interface EngineState { ready: boolean; running: boolean; depth: number; lines: EngineLine[]; fen: string | null }

const WORKER_URL = "/engine/stockfish-19-lite-single.js";

function toSan(fen: string, uci: string[]) {
  const board = new Chess(fen);
  const out: string[] = [];
  for (const m of uci.slice(0, 12)) {
    try { out.push(board.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }).san); } catch { break; }
  }
  return out;
}

export function useStockfish(fen: string, enabled: boolean, { depth = 20, multipv = 3 } = {}): EngineState {
  const worker = useRef<Worker | null>(null);
  const searching = useRef<string | null>(null);   // fen of the running search
  const queued = useRef<string | null>(null);      // fen to search once the current one stops
  const [state, setState] = useState<EngineState>({ ready: false, running: false, depth: 0, lines: [], fen: null });

  useEffect(() => {
    if (!enabled) return;
    const w = new Worker(WORKER_URL);
    worker.current = w;
    const start = (f: string) => {
      searching.current = f;
      setState(s => ({ ...s, running: true, depth: 0, lines: [], fen: f }));
      w.postMessage(`position fen ${f}`);
      w.postMessage(`go depth ${depth}`);
    };
    w.onmessage = (e: MessageEvent<string>) => {
      const line = String(e.data);
      if (line === "uciok") { w.postMessage(`setoption name MultiPV value ${multipv}`); w.postMessage("isready"); return; }
      if (line === "readyok") { setState(s => ({ ...s, ready: true })); if (queued.current) { const f = queued.current; queued.current = null; start(f); } return; }
      if (line.startsWith("bestmove")) {
        const next = queued.current;
        if (next) { queued.current = null; start(next); } else setState(s => ({ ...s, running: false }));
        return;
      }
      if (!line.startsWith("info") || !line.includes(" pv ") || !searching.current) return;
      const f = searching.current;
      const m = /depth (\d+).*?multipv (\d+).*?score (cp|mate) (-?\d+).*? pv (.+)$/.exec(line);
      if (!m) return;
      const sign = f.split(" ")[1] === "w" ? 1 : -1;
      const uci = m[5].trim().split(/\s+/);
      const entry: EngineLine = {
        depth: Number(m[1]), multipv: Number(m[2]), uci, pv: toSan(f, uci),
        cp: m[3] === "cp" ? Number(m[4]) * sign : null, mate: m[3] === "mate" ? Number(m[4]) * sign : null,
      };
      setState(s => {
        if (s.fen !== f) return s;
        const lines = [...s.lines.filter(l => l.multipv !== entry.multipv), entry].sort((a, b) => a.multipv - b.multipv);
        return { ...s, depth: Math.max(s.depth, entry.depth), lines };
      });
    };
    queued.current = fen;
    w.postMessage("uci");
    return () => { w.postMessage("quit"); w.terminate(); worker.current = null; searching.current = null; setState({ ready: false, running: false, depth: 0, lines: [], fen: null }); };
    // The worker lives as long as analysis is switched on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    const w = worker.current;
    if (!enabled || !w || !state.ready) return;
    if (searching.current === fen && (state.running || state.lines.length)) return;
    if (state.running) { queued.current = fen; w.postMessage("stop"); }
    else { queued.current = null; searching.current = fen; setState(s => ({ ...s, running: true, depth: 0, lines: [], fen })); w.postMessage(`position fen ${fen}`); w.postMessage(`go depth ${depth}`); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, enabled, state.ready]);

  return state;
}
