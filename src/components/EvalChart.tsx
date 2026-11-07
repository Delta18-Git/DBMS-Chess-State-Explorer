"use client";

import { useRef, useState } from "react";

export interface EvalPoint { ply: number; label: string; cp: number | null; loss: number | null }

const W = 760, H = 150, PAD = { l: 30, r: 6, t: 6, b: 18 };
const CLAMP = 500; // ±5 pawns: beyond that the game is decided
export const BLUNDER = 200, MISTAKE = 100;

/**
 * Stockfish evaluation after every move, White's point of view. The white area grows upward when
 * White is better and the black area downward when Black is better. Red dots = blunders
 * (≥2 pawns lost), yellow = mistakes (≥1 pawn). Click anywhere to jump to that move.
 */
export function EvalChart({ points, startCp, current, onSelect }: { points: EvalPoint[]; startCp: number | null; current: number; onSelect: (ply: number) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(1, points.length);
  const x = (ply: number) => PAD.l + (ply / n) * (W - PAD.l - PAD.r);
  const y = (cp: number) => PAD.t + ((CLAMP - Math.max(-CLAMP, Math.min(CLAMP, cp))) / (2 * CLAMP)) * (H - PAD.t - PAD.b);
  const zero = y(0);

  // Unscored moves carry the previous score so the area stays continuous.
  let last = startCp ?? 0;
  const series = [{ ply: 0, cp: last }, ...points.map(p => { if (p.cp !== null) last = p.cp; return { ply: p.ply, cp: last }; })];
  const line = series.map((p, i) => `${i ? "L" : "M"}${x(p.ply).toFixed(1)},${y(p.cp).toFixed(1)}`).join("");
  const plyAt = (clientX: number) => {
    const box = ref.current!.getBoundingClientRect();
    const sx = ((clientX - box.left) / box.width) * W;
    return Math.max(0, Math.min(points.length, Math.round(((sx - PAD.l) / (W - PAD.l - PAD.r)) * n)));
  };
  const h = hover ? points[hover - 1] : null;
  const marks = points.filter(p => p.loss !== null && p.loss >= MISTAKE && p.cp !== null);

  return (
    <div className="chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evaluation after each move"
        onMouseMove={e => setHover(plyAt(e.clientX))} onMouseLeave={() => setHover(null)} onClick={e => onSelect(plyAt(e.clientX))}>
        <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} className="area-b" />
        <path d={`${line}L${x(n)},${H - PAD.b}L${x(0)},${H - PAD.b}Z`} className="area-w" />
        <line x1={PAD.l} x2={W - PAD.r} y1={zero} y2={zero} stroke="#8a919c" strokeDasharray="3 3" />
        {[-400, 0, 400].map(t => <text key={t} x={PAD.l - 5} y={y(t) + 3.5} className="tick" textAnchor="end">{t > 0 ? `+${t / 100}` : t / 100}</text>)}
        {Array.from({ length: Math.floor(n / 20) }, (_, i) => (i + 1) * 20).map(t => (
          <text key={t} x={x(t)} y={H - 5} className="tick" textAnchor="middle">{t / 2}</text>
        ))}
        <path d={line} fill="none" stroke="#6b7380" strokeWidth={1} />
        {marks.map(p => <circle key={p.ply} cx={x(p.ply)} cy={y(p.cp!)} r={3.6} className={p.loss! >= BLUNDER ? "dot-blunder" : "dot-mistake"} />)}
        <line x1={x(current)} x2={x(current)} y1={PAD.t} y2={H - PAD.b} className="cursor" />
        {h && <line x1={x(h.ply)} x2={x(h.ply)} y1={PAD.t} y2={H - PAD.b} stroke="#8a919c" strokeDasharray="2 2" />}
      </svg>
      <div className="row between tiny muted" style={{ marginTop: 4 }}>
        <span>{h ? <><b className="ink-2">{h.label}</b> · {h.cp === null ? "not scored" : `${h.cp > 0 ? "+" : ""}${(h.cp / 100).toFixed(2)}`}{h.loss !== null && h.loss >= MISTAKE ? ` · lost ${(h.loss / 100).toFixed(1)}` : ""}</> : "Hover to read, click to jump"}</span>
        <span className="row" style={{ gap: 10 }}>
          <span className="row" style={{ gap: 4 }}><i className="dot" style={{ background: "var(--bad)" }} />blunder</span>
          <span className="row" style={{ gap: 4 }}><i className="dot" style={{ background: "var(--warn)" }} />mistake</span>
        </span>
      </div>
    </div>
  );
}
