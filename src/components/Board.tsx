"use client";

import { Chessboard } from "react-chessboard";

export type BoardArrow = { startSquare: string; endSquare: string; color: string };

/** Read-only board for a FEN (display only: moves are entered as PGN/SAN and validated server-side). */
export function Board({ fen, arrows = [], orientation = "white", highlight = [], id = "board" }: {
  fen: string; arrows?: BoardArrow[]; orientation?: "white" | "black"; highlight?: string[]; id?: string;
}) {
  const squareStyles = Object.fromEntries(highlight.map(sq => [sq, { background: "var(--board-highlight)" }]));
  return (
    <div className="board" aria-label={`Chess board: ${fen}`}>
      <Chessboard options={{
        id, position: fen, boardOrientation: orientation, allowDragging: false, arrows,
        squareStyles, animationDurationInMs: 150,
        darkSquareStyle: { backgroundColor: "var(--board-dark)" },
        lightSquareStyle: { backgroundColor: "var(--board-light)" },
        boardStyle: { borderRadius: 6, overflow: "hidden" },
      }} />
    </div>
  );
}
