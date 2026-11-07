"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Chess } from "chess.js";
import { Board, type BoardArrow } from "./Board";
import { EnginePanel } from "./EnginePanel";
import { useStockfish } from "./useStockfish";
import { Icon } from "./Icon";

/** Board you can play on: every move jumps to that board in the database (or says it is new). */
export function ExplorerBoard({ fen, line, next, stored, autoEngine = false }: {
  fen: string; line: string[]; next: { san: string; to_position_id: number; games: number }[];
  stored?: { cp: number | null; mate: number | null; best: string | null }; autoEngine?: boolean;
}) {
  const router = useRouter();
  const [flipped, setFlipped] = useState(false);
  const [engineOn, setEngineOn] = useState(autoEngine);
  // The board moves at once (with animation) while the next position loads from the server.
  const [shown, setShown] = useState(fen);
  const [loading, startLoading] = useTransition();
  useEffect(() => setShown(fen), [fen]);
  const engine = useStockfish(fen, engineOn);
  const live = engineOn && engine.fen === fen ? engine.lines[0] : undefined;

  const go = (san: string) => {
    const moves = [...line, san];
    const hit = next.find(m => m.san === san);
    try { const b = new Chess(fen); b.move(san); setShown(b.fen()); } catch { /* illegal: ignore */ }
    startLoading(() => router.push(hit ? `/positions/${hit.to_position_id}?line=${encodeURIComponent(moves.join(" "))}` : `/positions?moves=${encodeURIComponent(moves.join(" "))}`, { scroll: false }));
  };
  const back = () => { if (line.length) startLoading(() => router.push(line.length === 1 ? "/positions" : `/positions?moves=${encodeURIComponent(line.slice(0, -1).join(" "))}`, { scroll: false })); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, dialog")) return;
      if (e.key === "ArrowLeft") back();
      if (e.key === "ArrowRight" && next[0]) go(next[0].san);
      if (e.key === "f") setFlipped(f => !f);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Arrows: the three most played moves (dark → light grey by popularity), then the engine's
  // choice (blue live / green stored), which replaces a grey arrow on the same squares.
  const arrows: BoardArrow[] = [];
  const greys = ["#3a404a", "#7a818c", "#a9afb8"];
  next.slice(0, 3).forEach((m, i) => {
    try { const mv = new Chess(fen).move(m.san); arrows.push({ startSquare: mv.from, endSquare: mv.to, color: greys[i] }); } catch { /* ignore */ }
  });
  const best = live?.pv[0] ?? stored?.best ?? null;
  if (best) { try { const mv = new Chess(fen).move(best); arrows.push({ startSquare: mv.from, endSquare: mv.to, color: live ? "#2456d3" : "#19794a" }); } catch { /* ignore */ } }

  return (
    <div className="explorer-board">
      <nav className="breadcrumbs" aria-label="Moves played">
        <Link href="/positions">Start</Link>
        {line.map((san, i) => {
          const label = `${i % 2 === 0 ? `${i / 2 + 1}.` : ""}${san}`;
          return i === line.length - 1 ? <span key={i} className="cur">{label}</span>
            : <Link key={i} href={`/positions?moves=${encodeURIComponent(line.slice(0, i + 1).join(" "))}`}>{label}</Link>;
        })}
      </nav>
      <Board fen={shown} orientation={flipped ? "black" : "white"} onMove={go} arrows={shown === fen ? arrows : []} id="explorer" className={loading ? "loading" : ""} />
      <div className="row between">
        <span className="tiny muted">Drag or click a piece to play a move · ← back · F flip</span>
        <span className="row" style={{ gap: 4 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={back} disabled={!line.length} aria-label="Take back"><Icon name="prev" /></button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFlipped(f => !f)} aria-label="Flip board"><Icon name="flip" /></button>
        </span>
      </div>
      <div className="panel"><div className="panel-section"><EnginePanel on={engineOn} onToggle={setEngineOn} state={engine} fen={fen} moveNumber={Math.floor(line.length / 2) + 1} /></div></div>
    </div>
  );
}
