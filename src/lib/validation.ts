import { z } from "zod";
import { ApiError, date, foreignId } from "./http";

const name = (max: number) => z.string().trim().min(1).max(max);
export const playerSchema = z.object({
  name: name(100), title: name(10).nullable().optional(),
  federation: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  birth_year: z.number().int().min(1850).max(2100).nullable().optional(),
  rating: z.number().int().min(0).max(3500).nullable().optional(),
}).strict();
export const tournamentSchema = z.object({ name: name(150), date: date.nullable().optional(), location: name(150).nullable().optional() }).strict();
export const openingSchema = z.object({ eco: z.string().regex(/^[A-E][0-9]{2}$/), name: name(150) }).strict();
export const positionSchema = z.object({ fen: z.string().min(15).max(100), comment: z.string().max(10000).nullable().default(null) }).strict();
export const resultSchema = z.enum(["1-0", "0-1", "1/2-1/2", "*"]);
export const gameSchema = z.object({
  white_player_id: foreignId, black_player_id: foreignId,
  tournament_id: foreignId.nullable().default(null), opening_id: foreignId.nullable().default(null),
  date: date.nullable().default(null), result: resultSchema.optional(),
  pgn: z.string().trim().min(1).max(60000),
}).strict().refine(g => g.white_player_id !== g.black_player_id, { message: "Players must be distinct" });
export const gamePatchSchema = z.object({
  tournament_id: foreignId.nullable().optional(), opening_id: foreignId.nullable().optional(),
  date: date.nullable().optional(),
}).strict().refine(v => Object.keys(v).length > 0, { message: "Provide at least one field" });
export const evaluationSchema = z.object({
  position_id: foreignId, cp: z.number().int().min(-100000).max(100000).nullable(),
  depth: z.number().int().min(1).max(255),
  mate: z.number().int().min(-300).max(300).nullable().default(null),
  best_move_san: z.string().trim().min(2).max(10).nullable().default(null),
}).strict().refine(e => e.cp === null || e.mate === null, { message: "Give either cp or mate, not both" });
export const repertoireSchema = z.object({ player_id: foreignId, name: name(100), color: z.enum(["w", "b"]).default("w") }).strict();
export const userSchema = z.object({
  email: z.email().max(254).transform(v => v.toLowerCase()), display_name: name(100),
  role: z.enum(["admin", "analyst"]), password: z.string().min(12).max(256),
}).strict();
export const lineSchema = z.object({ start_position_id: foreignId, move_san: name(10) }).strict();
export const loginSchema = z.object({ email: z.email().max(254).transform(v => v.toLowerCase()), password: z.string().min(1).max(256) }).strict();

// User words -> safe BOOLEAN MODE query: strip operators, require every word, allow prefixes.
export function booleanQuery(q: string) {
  const words = q.split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2).slice(0, 8);
  if (!words.length) throw new ApiError(400, "q: enter at least one word of two or more letters");
  return words.map(w => `+${w}*`).join(" ");
}
