import { Chess, DEFAULT_POSITION } from "chess.js";
import { ApiError } from "./http";

export function canonicalFen(fen: string) {
  try {
    const board = new Chess(fen);
    // Clocks do not identify a board node. chess.js omits irrelevant en-passant targets.
    return board.fen().split(" ").slice(0, 4).join(" ") + " 0 1";
  } catch { throw new ApiError(400, "Invalid FEN"); }
}

export function parseGame(pgn: string, requestedResult?: string) {
  const board = new Chess();
  try { board.loadPgn(pgn, { strict: true }); }
  catch { throw new ApiError(400, "Invalid PGN or illegal move"); }
  const headers = board.getHeaders();
  if (headers.FEN && headers.FEN !== DEFAULT_POSITION) throw new ApiError(400, "Only standard-start chess games are supported");
  if (headers.Variant && headers.Variant.toLowerCase() !== "standard") throw new ApiError(400, "Only standard chess is supported");
  const moves = board.history({ verbose: true });
  if (!moves.length || moves.length > 1000) throw new ApiError(400, "PGN must contain 1–1000 plies");
  const result = requestedResult ?? headers.Result ?? "*";
  if (!["1-0", "0-1", "1/2-1/2", "*"].includes(result)) throw new ApiError(400, "Invalid game result");
  if (requestedResult && headers.Result && headers.Result !== "*" && headers.Result !== requestedResult) throw new ApiError(400, "Result conflicts with PGN");
  if (board.isCheckmate() && result !== (board.turn() === "w" ? "0-1" : "1-0")) throw new ApiError(400, "Result conflicts with checkmate");
  if (board.isStalemate() && result !== "1/2-1/2") throw new ApiError(400, "Result conflicts with stalemate");
  board.setHeader("Result", result);
  return { result, pgn: board.pgn(), moves };
}

export function legalSan(fen: string, san: string) {
  try { return new Chess(fen).move(san, { strict: true }).san; }
  catch { throw new ApiError(400, "Illegal repertoire move for this position"); }
}
