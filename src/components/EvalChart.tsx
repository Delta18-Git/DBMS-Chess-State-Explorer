"use client";

import { useId, useRef, useState } from "react";

export interface EvalPoint { ply: number; label: string; cp: number | null; loss: number | null }

const W = 720, H = 180, PAD = { l: 34, r: 8, t: 10, b: 22 };
const CLAMP = 600; // ±6 pawns: beyond that the game is decided; keeps the opening readable
const BLUNDER = 200;

/**
 * Engine evaluation after each ply (White's perspective). Polarity is the job, so it uses the
 * diverging pair: area above 0 = White better (blue), below = Black better (red), neutral line.
 * Null scores (mate / unscored) break the line rather than inventing a value.
 */
export function EvalChart({ points, startCp, current, onSelect }: { points: EvalPoint[]; startCp: number | null; current: number; onSelect: (ply: number) => void }) {
  const clip = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(1, points.length);
  const x = (ply: number) => PAD.l + (ply / n) * (W - PAD.l - PAD.r);
  const y = (cp: number) => PAD.t + ((CLAMP - Math.max(-CLAMP, Math.min(CLAMP, cp))) / (2 * CLAMP)) * (H - PAD.t - PAD.b);
  const zero = y(0);

  // Contiguous runs of scored points -> line + area segments.
  const runs: EvalPoint[][] = [];
  let run: EvalPoint[] = [];
  for (const p of [{ ply: 0, label: "start", cp: startCp, loss: null } as EvalPoint, ...points]) {
    if (p.cp === null) { if (run.length) runs.push(run); run = []; } else run.push(p);
  }
  if (run.length) runs.push(run);
  const line = (r: EvalPoint[]) => r.map((p, i) => `${i ? "L" : "M"}${x(p.ply).toFixed(1)},${y(p.cp!).toFixed(1)}`).join("");
  const area = (r: EvalPoint[]) => `${line(r)}L${x(r.at(-1)!.ply).toFixed(1)},${zero}L${x(r[0].ply).toFixed(1)},${zero}Z`;

  const ticks = [-400, 0, 400];
  const moveTicks = Array.from({ length: Math.floor(n / 20) + 1 }, (_, i) => i * 20).filter(t => t > 0 && t <= n);
  const blunders = points.filter(p => p.loss !== null && p.loss >= BLUNDER && p.cp !== null);

  function plyAt(clientX: number) {
    const box = ref.current!.getBoundingClientRect();
    const sx = ((clientX - box.left) / box.width) * W;
    return Math.max(1, Math.min(points.length, Math.round(((sx - PAD.l) / (W - PAD.l - PAD.r)) * n)));
  }
  const h = hover !== null ? points[hover - 1] : null;

  return (
    <figure className="eval-chart">
      <figcaption className="chart-title">Engine evaluation by move <span className="muted">(pawns, White&apos;s view; click to jump)</span></figcaption>
      <div className="chart-wrap">
        <svg
          ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evaluation after each move"
          onMouseMove={e => setHover(plyAt(e.clientX))} onMouseLeave={() => setHover(null)}
          onClick={e => onSelect(plyAt(e.clientX))}
        >
          <defs>
            <clipPath id={`${clip}-up`}><rect x={0} y={0} width={W} height={zero} /></clipPath>
            <clipPath id={`${clip}-down`}><rect x={0} y={zero} width={W} height={H - zero} /></clipPath>
          </defs>
          {ticks.map(t => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className={t === 0 ? "axis" : "gridline"} />
              <text x={PAD.l - 6} y={y(t) + 4} className="tick" textAnchor="end">{t > 0 ? `+${t / 100}` : t / 100}</text>
            </g>
          ))}
          {moveTicks.map(t => (
            <text key={t} x={x(t)} y={H - 6} className="tick" textAnchor="middle">{Math.ceil(t / 2)}</text>
          ))}
          {runs.map((r, i) => (
            <g key={i}>
              <path d={area(r)} className="area-white" clipPath={`url(#${clip}-up)`} />
              <path d={area(r)} className="area-black" clipPath={`url(#${clip}-down)`} />
              <path d={line(r)} className="eval-line" />
            </g>
          ))}
          <line x1={x(current)} x2={x(current)} y1={PAD.t} y2={H - PAD.b} className="cursor" />
          {blunders.map(p => (
            <circle key={p.ply} cx={x(p.ply)} cy={y(p.cp!)} r={4.5} className="blunder-dot" />
          ))}
          {h && (
            <g pointerEvents="none">
              <line x1={x(h.ply)} x2={x(h.ply)} y1={PAD.t} y2={H - PAD.b} className="crosshair" />
              {h.cp !== null && <circle cx={x(h.ply)} cy={y(h.cp)} r={4} className="hover-dot" />}
            </g>
          )}
        </svg>
        {h && (
          <div className="tooltip" style={{ left: `${(x(h.ply) / W) * 100}%` }}>
            <strong>{h.label}</strong>
            <span>{h.cp === null ? "no centipawn score" : `${h.cp > 0 ? "+" : ""}${(h.cp / 100).toFixed(2)}`}</span>
            {h.loss !== null && h.loss >= BLUNDER && <span className="tag tag-critical">⚠ Blunder −{(h.loss / 100).toFixed(1)}</span>}
          </div>
        )}
      </div>
      <div className="legend">
        <span><i className="swatch swatch-white" /> White better</span>
        <span><i className="swatch swatch-black" /> Black better</span>
        <span><i className="swatch swatch-blunder" /> Blunder (≥2 pawns lost)</span>
      </div>
    </figure>
  );
}
