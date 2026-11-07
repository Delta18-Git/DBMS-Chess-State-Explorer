"use client";

import type { EngineState } from "./useStockfish";
import { pawns } from "./ui";

/** Vertical evaluation bar (White's share from the bottom), like on chess sites. */
export function EvalBar({ cp, mate, flipped = false }: { cp: number | null; mate: number | null; flipped?: boolean }) {
  const white = mate !== null ? (mate > 0 ? 100 : 0) : cp === null ? 50 : 50 + 50 * (2 / (1 + Math.exp(-0.004 * cp)) - 1);
  const label = mate !== null || cp !== null ? pawns(cp, mate).replace("+", "") : "";
  const whiteAhead = white >= 50;
  return (
    <div className="evalbar" aria-label={`Evaluation ${label || "unknown"}`} style={flipped ? { transform: "rotate(180deg)" } : undefined}>
      <i style={{ height: `${white}%` }} />
      {label && <span className={whiteAhead ? "bottom" : "top"} style={flipped ? { transform: "rotate(180deg)" } : undefined}>{label}</span>}
    </div>
  );
}

/** Live Stockfish 19 running in the browser: top lines for the current board. */
/** `moveNumber` is the number of the next move (stored FENs are canonical, so their clocks are not real). */
export function EnginePanel({ on, onToggle, state, fen, moveNumber }: { on: boolean; onToggle: (on: boolean) => void; state: EngineState; fen: string; moveNumber?: number }) {
  const fresh = state.fen === fen;
  const black = fen.split(" ")[1] === "b";
  return (
    <div className="stack-sm">
      <div className="row between">
        <label className="switch"><input type="checkbox" checked={on} onChange={e => onToggle(e.target.checked)} /> Stockfish 19</label>
        <span className="tiny muted">{!on ? "runs in your browser" : !state.ready ? "loading engine…" : fresh ? `depth ${state.depth}${state.running ? "…" : ""}` : "thinking…"}</span>
      </div>
      {on && fresh && state.lines.map(l => (
        <div key={l.multipv} className="engine-line">
          <span className={`evalchip ${(l.mate ?? l.cp ?? 0) >= 0 ? "evalchip-w" : "evalchip-b"}`}>{pawns(l.cp, l.mate)}</span>
          <span className="truncate">{l.pv.map((san, i) => {
            const ply = i + (black ? 1 : 0);
            const no = moveNumber === undefined ? "" : ply % 2 === 0 ? `${moveNumber + Math.floor(ply / 2)}.` : i === 0 ? `${moveNumber}…` : "";
            return <span key={i}>{no}{i === 0 ? <b>{san}</b> : san} </span>;
          })}</span>
        </div>
      ))}
    </div>
  );
}
