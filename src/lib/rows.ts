import type { RowDataPacket } from "mysql2/promise";

export interface PlayerRow extends RowDataPacket {
  player_id: number; name: string; title: string | null; federation: string | null;
  birth_year: number | null; rating: number | null;
}
export interface TournamentRow extends RowDataPacket {
  tournament_id: number; name: string; date: string | null; location: string | null;
}
export interface OpeningRow extends RowDataPacket {
  opening_id: number; eco: string; name: string;
}
export interface GameRow extends RowDataPacket {
  game_id: number; white_player_id: number; black_player_id: number;
  tournament_id: number | null; opening_id: number | null; date: string | null;
  result: string; pgn: string | null;
}
