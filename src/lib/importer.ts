import type { Connection, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { ApiError } from "./http";
import { canonicalFen, parseGame } from "./chess";
import { pgnDate, type FidePlayer, type Headers } from "./lichess";

// Multi-game import shared by POST /api/import/pgn, POST /api/import/lichess and `npm run setup`.
// Like the graph relay, the CALLER owns the transaction (BEGIN before, COMMIT/ROLLBACK after),
// so a whole tournament imports atomically. Players, the tournament and openings are matched or
// created from the PGN headers; a game whose source URL is already stored is skipped.

type Db = PoolConnection | Connection;

export interface TournamentInput {
  name: string; date?: string | null; end_date?: string | null; location?: string | null;
  format?: string | null; time_control?: string | null; source_url?: string | null; image_url?: string | null;
}
export interface ImportOptions {
  tournament?: TournamentInput | null;      // create/update this tournament for every game
  tournamentId?: number | null;             // or attach every game to an existing tournament
  fide?: Map<number, FidePlayer>;           // FIDE records for enrichment
  photos?: Map<number, string>;             // Wikimedia Commons photo URLs by FIDE id
}
export interface ImportResult { tournament_id: number | null; imported: number; duplicates: number; failed: { game: string; error: string }[]; game_ids: number[] }

const clip = (s: string | null | undefined, n: number) => (s ? s.trim().slice(0, n) || null : null);
const elo = (s?: string) => { const v = Number(s); return Number.isInteger(v) && v > 0 && v <= 3500 ? v : null; };

async function upsertTournament(db: Db, t: TournamentInput) {
  if (t.source_url) {
    const [r] = await db.execute<ResultSetHeader>(
      `INSERT INTO tournament (name, date, end_date, location, format, time_control, source_url, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) AS new
       ON DUPLICATE KEY UPDATE tournament_id = LAST_INSERT_ID(tournament.tournament_id), name = new.name,
         date = new.date, end_date = new.end_date, location = new.location, format = new.format,
         time_control = new.time_control, image_url = new.image_url`,
      [clip(t.name, 150), t.date ?? null, t.end_date ?? null, clip(t.location, 150), clip(t.format, 100),
       clip(t.time_control, 150), t.source_url, clip(t.image_url, 500)],
    );
    return r.insertId;
  }
  const [found] = await db.execute<RowDataPacket[]>("SELECT tournament_id FROM tournament WHERE name = ? ORDER BY tournament_id LIMIT 1", [clip(t.name, 150)]);
  if (found.length) return Number(found[0].tournament_id);
  const [r] = await db.execute<ResultSetHeader>("INSERT INTO tournament (name, date, location) VALUES (?, ?, ?)", [clip(t.name, 150), t.date ?? null, clip(t.location, 150)]);
  return r.insertId;
}

export async function importGames(db: Db, games: { headers: Headers; pgn: string }[], options: ImportOptions = {}): Promise<ImportResult> {
  const tournamentId = options.tournamentId ?? (options.tournament ? await upsertTournament(db, options.tournament) : null);
  const players = new Map<string, number>();
  const openings = new Map<string, number | null>();
  const eventTournaments = new Map<string, number>();
  const result: ImportResult = { tournament_id: tournamentId, imported: 0, duplicates: 0, failed: [], game_ids: [] };

  async function player(name: string | undefined, title?: string, fideRaw?: string, rating?: string) {
    const cleanName = clip(name, 100);
    if (!cleanName || cleanName === "?") throw new ApiError(400, "PGN is missing a player name");
    const fideId = Number(fideRaw) > 0 ? Number(fideRaw) : null;
    const key = fideId ? `f${fideId}` : `n${cleanName}`;
    if (players.has(key)) return players.get(key)!;
    const fide = fideId ? options.fide?.get(fideId) : undefined;
    const photo = (fideId && options.photos?.get(fideId)) || null;
    const federation = fide?.federation && /^[A-Z]{3}$/.test(fide.federation) ? fide.federation : null;
    const birth = fide?.year && fide.year >= 1850 && fide.year <= 2100 ? fide.year : null;
    const values = [cleanName, clip(fide?.title ?? title, 10), federation, birth, fide?.standard ?? elo(rating), clip(photo, 500)];
    let id: number;
    if (fideId) {
      const [r] = await db.execute<ResultSetHeader>(
        `INSERT INTO player (fide_id, name, title, federation, birth_year, rating, photo_url) VALUES (?, ?, ?, ?, ?, ?, ?) AS new
         ON DUPLICATE KEY UPDATE player_id = LAST_INSERT_ID(player.player_id),
           title = COALESCE(new.title, player.title), federation = COALESCE(new.federation, player.federation),
           birth_year = COALESCE(new.birth_year, player.birth_year), rating = COALESCE(new.rating, player.rating),
           photo_url = COALESCE(new.photo_url, player.photo_url)`, [fideId, ...values],
      );
      id = r.insertId;
    } else {
      const [found] = await db.execute<RowDataPacket[]>("SELECT player_id FROM player WHERE name = ? AND fide_id IS NULL LIMIT 1", [cleanName]);
      if (found.length) id = Number(found[0].player_id);
      else {
        const [r] = await db.execute<ResultSetHeader>("INSERT INTO player (name, title, federation, birth_year, rating, photo_url) VALUES (?, ?, ?, ?, ?, ?)", values);
        id = r.insertId;
      }
    }
    players.set(key, id);
    return id;
  }

  async function opening(eco?: string, name?: string) {
    if (!eco || !/^[A-E]\d{2}$/.test(eco) || !name || name === "?") return null;
    const key = `${eco}|${name}`;
    if (!openings.has(key)) {
      const [r] = await db.execute<ResultSetHeader>(
        `INSERT INTO opening (eco, name) VALUES (?, ?) AS new ON DUPLICATE KEY UPDATE opening_id = LAST_INSERT_ID(opening.opening_id)`,
        [eco, clip(name, 150)],
      );
      openings.set(key, r.insertId);
    }
    return openings.get(key)!;
  }

  for (const { headers: h, pgn } of games) {
    const label = `${h.White ?? "?"} – ${h.Black ?? "?"}${h.Round ? ` (round ${h.Round})` : ""}`;
    const source = clip(h.GameURL ?? (h.Site?.startsWith("https://lichess.org/") ? h.Site : null), 300);
    if (source) {
      const [dupe] = await db.execute<RowDataPacket[]>("SELECT game_id FROM game WHERE source_url = ?", [source]);
      if (dupe.length) { result.duplicates++; continue; }
    }
    let parsed: ReturnType<typeof parseGame>;
    try { parsed = parseGame(pgn); }
    catch (error) { result.failed.push({ game: label, error: error instanceof Error ? error.message : "Invalid PGN" }); continue; }

    const white = await player(h.White, h.WhiteTitle, h.WhiteFideId, h.WhiteElo);
    const black = await player(h.Black, h.BlackTitle, h.BlackFideId, h.BlackElo);
    if (white === black) { result.failed.push({ game: label, error: "White and Black are the same player" }); continue; }
    let tid = tournamentId;
    const event = clip(h.Event, 150);
    if (tid === null && event && event !== "?") {
      if (!eventTournaments.has(event)) eventTournaments.set(event, await upsertTournament(db, { name: event, date: pgnDate(h.Date), location: clip(h.Site, 150) }));
      tid = eventTournaments.get(event)!;
    }

    const plies = parsed.moves.map((m, i) => ({ ply_no: i + 1, side: m.color, san: m.san, from: canonicalFen(m.before), to: canonicalFen(m.after) }));
    // A stable lock order reduces deadlocks when concurrent imports share positions.
    const fens = [...new Set(plies.flatMap(p => [p.from, p.to]))].sort();
    await db.execute(`INSERT INTO \`position\` (fen) VALUES ${fens.map(() => "(?)").join(",")} ON DUPLICATE KEY UPDATE position_id = position_id`, fens);
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT position_id, fen FROM \`position\` WHERE fen IN (${fens.map(() => "?").join(",")}) FOR SHARE`, fens);
    const ids = new Map<string, number>(rows.map(r => [r.fen, Number(r.position_id)]));
    const [g] = await db.execute<ResultSetHeader>(
      `INSERT INTO game (white_player_id, black_player_id, tournament_id, opening_id, date, round, result, pgn, white_elo, black_elo, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [white, black, tid, await opening(h.ECO, h.Opening), pgnDate(h.Date), clip(h.Round, 20), parsed.result, parsed.pgn, elo(h.WhiteElo), elo(h.BlackElo), source],
    );
    await db.execute(
      `INSERT INTO ply (game_id, ply_no, side, move_san, from_position_id, to_position_id) VALUES ${plies.map(() => "(?, ?, ?, ?, ?, ?)").join(",")}`,
      plies.flatMap(p => [g.insertId, p.ply_no, p.side, p.san, ids.get(p.from)!, ids.get(p.to)!]),
    );
    result.imported++;
    result.game_ids.push(g.insertId);
  }
  // Tournament read from the [Event] header: report it when every game shared that one event.
  if (result.tournament_id === null && eventTournaments.size === 1) result.tournament_id = [...eventTournaments.values()][0];
  return result;
}
