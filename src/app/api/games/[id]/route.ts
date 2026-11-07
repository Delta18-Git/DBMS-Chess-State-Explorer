import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { body, errorResponse, found, id, json, type IdContext } from "@/lib/http";
import { gamePatchSchema } from "@/lib/validation";
import type { GameRow } from "@/lib/rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const gameId = id.parse((await context.params).id);
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [games] = await connection.execute<RowDataPacket[]>(
      `SELECT g.*, w.name AS white_name, w.title AS white_title, w.federation AS white_federation, w.photo_url AS white_photo,
              b.name AS black_name, b.title AS black_title, b.federation AS black_federation, b.photo_url AS black_photo,
              o.eco, o.name AS opening_name, o.position_id AS opening_position_id,
              t.name AS tournament_name, t.location AS tournament_location
       FROM game g JOIN player w ON w.player_id = g.white_player_id JOIN player b ON b.player_id = g.black_player_id
       LEFT JOIN opening o ON o.opening_id = g.opening_id LEFT JOIN tournament t ON t.tournament_id = g.tournament_id
       WHERE g.game_id = ?`, [gameId],
    );
    const game = found(games);
    const [plies] = await connection.execute<RowDataPacket[]>(
      `SELECT p.*, f.fen AS from_fen, t.fen AS to_fen, a.before_cp, a.after_cp, a.cp_loss,
              eb.best_move_san AS best_move_san, ea.mate AS after_mate, ea.depth AS after_depth
       FROM ply p JOIN \`position\` f ON f.position_id = p.from_position_id
       JOIN \`position\` t ON t.position_id = p.to_position_id
       JOIN v_ply_analysis a ON a.ply_id = p.ply_id
       LEFT JOIN v_latest_evaluation eb ON eb.position_id = p.from_position_id
       LEFT JOIN v_latest_evaluation ea ON ea.position_id = p.to_position_id
       WHERE p.game_id = ? ORDER BY p.ply_no`, [gameId],
    );
    await connection.commit();
    return json({ ...game, plies });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
export async function PATCH(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const gameId = id.parse((await context.params).id);
    const patch = gamePatchSchema.parse(await body(request));
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [rows] = await connection.execute<GameRow[]>("SELECT * FROM game WHERE game_id = ? FOR UPDATE", [gameId]);
    const game = { ...found(rows), ...patch };
    // Moves/results remain immutable so PGN, ply history and metadata cannot disagree.
    await connection.execute("UPDATE game SET tournament_id = ?, opening_id = ?, date = ? WHERE game_id = ?", [game.tournament_id, game.opening_id, game.date, gameId]);
    await connection.commit();
    return json(game);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
export async function DELETE(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const gameId = id.parse((await context.params).id);
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT game_id FROM game WHERE game_id = ? FOR UPDATE", [gameId]);
    found(rows);
    await connection.execute("DELETE FROM ply WHERE game_id = ?", [gameId]);
    await connection.execute("DELETE FROM game WHERE game_id = ?", [gameId]);
    // Positions/evaluations may be shared by other games or repertoires. Never cascade-delete them.
    await connection.commit();
    return json({ deleted: gameId });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
