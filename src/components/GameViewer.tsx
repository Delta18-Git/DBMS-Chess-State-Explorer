"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Chess, DEFAULT_POSITION } from "chess.js";
import { Board } from "./Board";
import { EvalChart, type EvalPoint } from "./EvalChart";

export interface Ply {
  ply_no: number; side: "w" | "b"; move_san: string;
  from_position_id: number; to_position_id: number; from_fen: string; to_fen: string;
  before_cp: number | null; after_cp: number | null; cp_loss: number | string | null;
}

const fmt = (cp: number | null) => cp === null ? "—" : `${cp > 0 ? "+" : ""}${(cp / 100).toFixed(2)}`;
const BLUNDER = 200;

/** Step through a stored game: board, clickable move list with per-move loss, evaluation chart. */
export function GameViewer({ plies, noveltyPly, startPositionId }: { plies: Ply[]; noveltyPly: number | null; startPositionId: number | null }) {
  const [current, setCurrent] = useState(plies.length);
  // Replay SAN once to recover the from/to squares for arrows and highlights.
  const squares = useMemo(() => {
    const board = new Chess();
    return plies.map(p => { const m = board.move(p.move_san); return { from: m.from, to: m.to }; });
  }, [plies]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "ArrowLeft") setCurrent(c => Math.max(0, c - 1));
      if (e.key === "ArrowRight") setCurrent(c => Math.min(plies.length, c + 1));
      if (e.key === "Home") setCurrent(0);
      if (e.key === "End") setCurrent(plies.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [plies.length]);

  const fen = current === 0 ? DEFAULT_POSITION : plies[current - 1].to_fen;
  const positionId = current === 0 ? startPositionId : plies[current - 1].to_position_id;
  const last = current > 0 ? squares[current - 1] : null;
  const points: EvalPoint[] = plies.map(p => ({
    ply: p.ply_no, label: `${Math.ceil(p.ply_no / 2)}${p.side === "w" ? "." : "…"} ${p.move_san}`,
    cp: p.after_cp === null ? null : Number(p.after_cp), loss: p.cp_loss === null ? null : Number(p.cp_loss),
  }));
  const rows = [];
  for (let i = 0; i < plies.length; i += 2) rows.push([plies[i], plies[i + 1]]);

  const cell = (p?: Ply) => {
    if (!p) return <td />;
    const loss = p.cp_loss === null ? null : Number(p.cp_loss);
    return (
      <td>
        <button type="button" className={`move ${current === p.ply_no ? "move-current" : ""}`} onClick={() => setCurrent(p.ply_no)}>
          {p.move_san}
          {loss !== null && loss >= BLUNDER && <span className="tag tag-critical" title={`Lost ${(loss / 100).toFixed(1)} pawns`}>??</span>}
          {noveltyPly === p.ply_no && <span className="tag tag-novelty" title="First move no other stored game played here">N</span>}
        </button>
      </td>
    );
  };

  return (
    <div className="viewer">
      <div className="viewer-board">
        <Board fen={fen} highlight={last ? [last.from, last.to] : []} />
        <div className="viewer-controls" role="group" aria-label="Move navigation">
          <button type="button" className="btn btn-ghost" onClick={() => setCurrent(0)} aria-label="Start">⏮</button>
          <button type="button" className="btn btn-ghost" onClick={() => setCurrent(c => Math.max(0, c - 1))} aria-label="Previous">◀</button>
          <span className="muted">{current === 0 ? "Start" : points[current - 1].label}</span>
          <button type="button" className="btn btn-ghost" onClick={() => setCurrent(c => Math.min(plies.length, c + 1))} aria-label="Next">▶</button>
          <button type="button" className="btn btn-ghost" onClick={() => setCurrent(plies.length)} aria-label="End">⏭</button>
        </div>
        <p className="viewer-meta">
          Eval: <strong>{fmt(current === 0 ? (plies[0]?.before_cp ?? null) : plies[current - 1].after_cp)}</strong>
          {positionId && <> · <Link href={`/positions/${positionId}`}>Explore this position →</Link></>}
        </p>
      </div>
      <div className="viewer-moves">
        <table className="moves">
          <thead><tr><th>#</th><th>White</th><th>Black</th></tr></thead>
          <tbody>
            {rows.map(([w, b], i) => <tr key={i}><td className="muted">{i + 1}</td>{cell(w)}{cell(b)}</tr>)}
          </tbody>
        </table>
      </div>
      <div className="viewer-chart">
        <EvalChart points={points} startCp={plies[0]?.before_cp ?? null} current={current} onSelect={setCurrent} />
      </div>
    </div>
  );
}
