import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { canonicalFen, parseGame } from "@/lib/chess";
import { body, errorResponse, id, json, pagination } from "@/lib/http";
import { gameSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const { limit, offset } = pagination(request);
    const params = new URL(request.url).searchParams;
    const playerId = params.has("player_id") ? id.parse(params.get("player_id")) : null;
    const openingId = params.has("opening_id") ? id.parse(params.get("opening_id")) : null;
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT g.game_id, g.white_player_id, w.name AS white_name, g.black_player_id, b.name AS black_name,
              g.tournament_id, t.name AS tournament_name, g.opening_id, o.eco, o.name AS opening_name, g.date, g.result
       FROM game g JOIN player w ON w.player_id = g.white_player_id JOIN player b ON b.player_id = g.black_player_id
       LEFT JOIN tournament t ON t.tournament_id = g.tournament_id LEFT JOIN opening o ON o.opening_id = g.opening_id
       WHERE (? IS NULL OR g.white_player_id = ? OR g.black_player_id = ?) AND (? IS NULL OR g.opening_id = ?)
       ORDER BY g.game_id DESC LIMIT ? OFFSET ?`,
      [playerId, playerId, playerId, openingId, openingId, String(limit), String(offset)],
    );
    await connection.commit();
    return json(rows);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}

export async function POST(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const input = gameSchema.parse(await body(request));
    const parsed = parseGame(input.pgn, input.result);
    const plies = parsed.moves.map((move, index) => ({
      ply_no: index + 1, side: move.color, move_san: move.san,
      from: canonicalFen(move.before), to: canonicalFen(move.after),
    }));
    // A stable lock order reduces deadlocks when concurrent imports share positions.
    const fens = [...new Set(plies.flatMap(p => [p.from, p.to]))].sort();
    // Deduplication and the game/plies are ONE transaction. FK failure rolls back new nodes too.
    await connection.execute(
      `INSERT INTO \`position\` (fen) VALUES ${fens.map(() => "(?)").join(",")}
       ON DUPLICATE KEY UPDATE position_id = position_id`, fens,
    );
    const [positions] = await connection.execute<RowDataPacket[]>(
      `SELECT position_id, fen FROM \`position\` WHERE fen IN (${fens.map(() => "?").join(",")}) FOR SHARE`, fens,
    );
    const positionIds = new Map<string, number>(positions.map(p => [p.fen, p.position_id]));
    const [result] = await connection.execute<ResultSetHeader>(
      "INSERT INTO game (white_player_id, black_player_id, tournament_id, opening_id, date, result, pgn) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [input.white_player_id, input.black_player_id, input.tournament_id, input.opening_id, input.date, parsed.result, parsed.pgn],
    );
    await connection.execute(
      `INSERT INTO ply (game_id, ply_no, side, move_san, from_position_id, to_position_id)
       VALUES ${plies.map(() => "(?, ?, ?, ?, ?, ?)").join(",")}`,
      plies.flatMap(p => [result.insertId, p.ply_no, p.side, p.move_san, positionIds.get(p.from)!, positionIds.get(p.to)!]),
    );
    await connection.commit();
    return json({ game_id: result.insertId, result: parsed.result, plies: plies.length, positions: fens.length }, 201);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
