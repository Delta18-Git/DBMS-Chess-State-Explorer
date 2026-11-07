"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Chess, DEFAULT_POSITION } from "chess.js";
import { Board, type BoardArrow } from "./Board";
import { EvalChart, BLUNDER, MISTAKE, type EvalPoint } from "./EvalChart";
import { EnginePanel, EvalBar } from "./EnginePanel";
import { useStockfish } from "./useStockfish";
import { Icon } from "./Icon";
import { Avatar, Flag, TitleChip, moveNo } from "./ui";

export interface Ply {
  ply_no: number; side: "w" | "b"; move_san: string;
  from_position_id: number; to_position_id: number; from_fen: string; to_fen: string;
  before_cp: number | null; after_cp: number | null; cp_loss: number | string | null;
  best_move_san: string | null; after_mate: number | null;
}
export interface Side { id: number; name: string; title: string | null; federation: string | null; photo: string | null; elo: number | null; score: string }

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function squares(fen: string, san: string | null): { from: string; to: string } | null {
  if (!san) return null;
  try { const m = new Chess(fen).move(san); return { from: m.from, to: m.to }; } catch { return null; }
}

function PlayerBar({ p, color }: { p: Side; color: "w" | "b" }) {
  return (
    <div className="player-bar">
      <Link href={`/players/${p.id}`} className="person">
        <span className={`side-dot ${color}`} />
        <Avatar name={p.name} photo={p.photo} size="sm" />
        <span className="truncate"><TitleChip title={p.title} /> <span className="name">{p.name}</span> <span className="meta">{p.elo ?? ""}</span></span>
        {p.federation && <Flag code={p.federation} />}
      </Link>
      <strong className="mono">{p.score}</strong>
    </div>
  );
}

/** Replay a stored game: board with eval bar, move list with Stockfish annotations, live engine, chart. */
export function GameViewer({ plies, noveltyPly, startPositionId, white, black, initialPly }: {
  plies: Ply[]; noveltyPly: number | null; startPositionId: number | null; white: Side; black: Side; initialPly?: number;
}) {
  const [current, setCurrent] = useState(initialPly !== undefined ? Math.max(0, Math.min(plies.length, initialPly)) : 0);
  const [flipped, setFlipped] = useState(false);
  const [engineOn, setEngineOn] = useState(false);
  const moveSquares = useMemo(() => plies.map(p => squares(p.from_fen, p.move_san)), [plies]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, dialog")) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); setCurrent(c => Math.max(0, c - 1)); }
      if (e.key === "ArrowRight") { e.preventDefault(); setCurrent(c => Math.min(plies.length, c + 1)); }
      if (e.key === "Home") setCurrent(0);
      if (e.key === "End") setCurrent(plies.length);
      if (e.key === "f") setFlipped(f => !f);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [plies.length]);

  const fen = current === 0 ? DEFAULT_POSITION : plies[current - 1].to_fen;
  const positionId = current === 0 ? startPositionId : plies[current - 1].to_position_id;
  const engine = useStockfish(fen, engineOn);
  const stored = current === 0 ? { cp: num(plies[0]?.before_cp), mate: null } : { cp: num(plies[current - 1].after_mate) === null ? num(plies[current - 1].after_cp) : null, mate: num(plies[current - 1].after_mate) };
  const live = engineOn && engine.fen === fen ? engine.lines[0] : undefined;
  const barCp = live ? live.cp : stored.cp, barMate = live ? live.mate : stored.mate;

  // Arrow: live engine's best move, otherwise the stored Stockfish best move for this position.
  const next = plies[current];
  const bestSan = live?.pv[0] ?? next?.best_move_san ?? null;
  const best = squares(fen, bestSan);
  const arrows: BoardArrow[] = best ? [{ startSquare: best.from, endSquare: best.to, color: live ? "#2456d3" : "#19794a" }] : [];
  const last = current > 0 ? moveSquares[current - 1] : null;

  const points: EvalPoint[] = plies.map(p => ({
    ply: p.ply_no, label: `${moveNo(p.ply_no)} ${p.move_san}`,
    cp: num(p.after_mate) !== null ? Math.sign(Number(p.after_mate)) * 1000 : num(p.after_cp), loss: num(p.cp_loss),
  }));
  const cur = current > 0 ? plies[current - 1] : null;
  const loss = cur ? num(cur.cp_loss) : null;
  const quality = loss === null ? null : loss >= BLUNDER ? "blunder" : loss >= MISTAKE ? "mistake" : null;

  const rows: [Ply, Ply | undefined][] = [];
  for (let i = 0; i < plies.length; i += 2) rows.push([plies[i], plies[i + 1]]);
  const cell = (p?: Ply) => {
    if (!p) return <span />;
    const l = num(p.cp_loss);
    const mark = l !== null && l >= BLUNDER ? <span className="mark q-blunder">??</span> : l !== null && l >= MISTAKE ? <span className="mark q-mistake">?</span> : null;
    return (
      <button type="button" className={current === p.ply_no ? "current" : ""} onClick={() => setCurrent(p.ply_no)}>
        {p.move_san}{mark}{noveltyPly === p.ply_no && <span className="mark" title="Novelty: no other stored game played this here" style={{ color: current === p.ply_no ? "#fff" : "var(--accent)" }}>N</span>}
      </button>
    );
  };
  const top = flipped ? white : black, bottom = flipped ? black : white;

  return (
    <div className="stack">
      <div className="viewer">
        <EvalBar cp={barCp} mate={barMate} flipped={flipped} />
        <div>
          <PlayerBar p={top} color={flipped ? "w" : "b"} />
          <Board fen={fen} orientation={flipped ? "black" : "white"} highlight={last ? [last.from, last.to] : []} arrows={arrows} id="game" />
          <PlayerBar p={bottom} color={flipped ? "b" : "w"} />
          <div className="controls" role="group" aria-label="Move navigation">
            <button type="button" className="btn btn-ghost" onClick={() => setCurrent(0)} aria-label="First move"><Icon name="first" /></button>
            <button type="button" className="btn btn-ghost" onClick={() => setCurrent(c => Math.max(0, c - 1))} aria-label="Previous move"><Icon name="prev" /></button>
            <button type="button" className="btn btn-ghost" onClick={() => setCurrent(c => Math.min(plies.length, c + 1))} aria-label="Next move"><Icon name="next" /></button>
            <button type="button" className="btn btn-ghost" onClick={() => setCurrent(plies.length)} aria-label="Last move"><Icon name="last" /></button>
            <button type="button" className="btn btn-ghost" onClick={() => setFlipped(f => !f)} aria-label="Flip board" title="Flip board (F)"><Icon name="flip" /></button>
          </div>
        </div>
        <div className="panel">
          <div className="panel-section">
            <div className="row between">
              <span className="small ink-2">{cur ? <><b className="mono">{moveNo(cur.ply_no)} {cur.move_san}</b> · move {Math.ceil(cur.ply_no / 2)} of {Math.ceil(plies.length / 2)}</> : "Starting position"}</span>
              {positionId && <Link href={`/positions/${positionId}`} className="small row" style={{ gap: 4 }}><Icon name="explore" />Open in explorer</Link>}
            </div>
            {quality && cur && (
              <div className="annot" style={{ marginTop: 8 }}>
                <span className={`badge ${quality === "blunder" ? "chip-bad" : "chip-warn"}`}>{quality === "blunder" ? "Blunder" : "Mistake"}</span>
                <span>Lost {(loss! / 100).toFixed(1)} pawns.{cur.best_move_san && cur.best_move_san !== cur.move_san ? <> Stockfish preferred <b className="mono">{cur.best_move_san}</b>.</> : null}</span>
              </div>
            )}
            {cur && noveltyPly === cur.ply_no && (
              <div className="annot" style={{ marginTop: 8 }}><span className="badge chip-accent">Novelty</span><span>No other game in the database played this move here.</span></div>
            )}
          </div>
          <div className="movelist" role="list" aria-label="Moves">
            {rows.map(([w, b], i) => (
              <div key={i} style={{ display: "contents" }}><span className="no">{i + 1}</span>{cell(w)}{cell(b)}</div>
            ))}
          </div>
          <div className="panel-section">
            <EnginePanel on={engineOn} onToggle={setEngineOn} state={engine} fen={fen} moveNumber={Math.floor(current / 2) + 1} />
          </div>
        </div>
      </div>
      <section className="card card-body">
        <div className="row between" style={{ marginBottom: 8 }}><h2>Evaluation</h2><span className="db">Stockfish · stored in MySQL</span></div>
        <EvalChart points={points} startCp={num(plies[0]?.before_cp)} current={current} onSelect={setCurrent} />
      </section>
    </div>
  );
}
