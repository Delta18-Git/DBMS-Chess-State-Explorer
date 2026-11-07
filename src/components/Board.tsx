"use client";

import { useState } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";

export type BoardArrow = { startSquare: string; endSquare: string; color: string };

// Arrows: solid colours (the library applies one opacity to the whole arrow; translucent colours
// would make the shaft and head overlap visibly). Arrows start near the base of the piece.
const ARROW_OPTIONS = {
  colors: { default: "#2456d3", shift: "#19794a", ctrl: "#c23b3b", alt: "#6b7380", meta: "#2456d3" },
  color: "#2456d3", secondaryColor: "#19794a", tertiaryColor: "#c23b3b",
  arrowLengthReducerDenominator: 6, sameTargetArrowLengthReducerDenominator: 4,
  arrowWidthDenominator: 6, activeArrowWidthMultiplier: 0.9, opacity: 0.8, activeOpacity: 0.6, arrowStartOffset: 0.32,
};
/** One arrow per from→to square pair; the last one given wins (e.g. the engine's over popularity). */
function uniqueArrows(arrows: BoardArrow[]) {
  const map = new Map<string, BoardArrow>();
  for (const a of arrows) if (a.startSquare !== a.endSquare) map.set(`${a.startSquare}${a.endSquare}`, a);
  return [...map.values()];
}

/**
 * Chess board for a FEN. Pass `onMove` to let the user play moves (drag, or click a piece then a
 * square); the board only shows legal targets and calls onMove with the SAN that was played.
 */
export function Board({ fen, arrows = [], orientation = "white", highlight = [], id = "board", onMove, notation = true, className = "" }: {
  fen: string; arrows?: BoardArrow[]; orientation?: "white" | "black"; highlight?: string[]; id?: string;
  onMove?: (san: string) => void; notation?: boolean; className?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const game = onMove ? new Chess(fen) : null;
  const targets = selected && game ? game.moves({ square: selected as Square, verbose: true }).map(m => m.to) : [];

  function tryMove(from: string, to: string | null) {
    if (!game || !to) return false;
    try {
      const move = game.move({ from, to, promotion: "q" });
      setSelected(null);
      onMove!(move.san);
      return true;
    } catch { return false; }
  }

  const styles: Record<string, React.CSSProperties> = {};
  for (const sq of highlight) styles[sq] = { background: "var(--board-last)" };
  if (selected) styles[selected] = { background: "rgba(36, 86, 211, 0.35)" };
  for (const sq of targets) styles[sq] = { ...styles[sq], backgroundImage: "radial-gradient(circle, rgba(20, 30, 40, 0.28) 22%, transparent 24%)" };

  return (
    <div className={`board ${className}`} aria-label={`Chess board: ${fen}`}>
      <Chessboard options={{
        id, position: fen, boardOrientation: orientation, arrows: uniqueArrows(arrows), arrowOptions: ARROW_OPTIONS, squareStyles: styles,
        allowDragging: Boolean(onMove), allowDrawingArrows: false, animationDurationInMs: 160, showNotation: notation,
        darkSquareStyle: { backgroundColor: "var(--board-dark)" },
        lightSquareStyle: { backgroundColor: "var(--board-light)" },
        darkSquareNotationStyle: { color: "var(--board-light)", fontWeight: 600 },
        lightSquareNotationStyle: { color: "var(--board-dark)", fontWeight: 600 },
        canDragPiece: ({ piece }) => Boolean(game) && piece.pieceType[0] === game!.turn(),
        onPieceDrop: ({ sourceSquare, targetSquare }) => tryMove(sourceSquare, targetSquare),
        onSquareClick: ({ square, piece }) => {
          if (!game) return;
          if (selected && targets.includes(square as Square)) { tryMove(selected, square); return; }
          setSelected(piece && piece.pieceType[0] === game.turn() ? square : null);
        },
      }} />
    </div>
  );
}
