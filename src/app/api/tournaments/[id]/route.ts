import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { body, errorResponse, found, id, json, type IdContext } from "@/lib/http";
import { tournamentSchema } from "@/lib/validation";
import type { TournamentRow } from "@/lib/rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const tournamentId = id.parse((await context.params).id);
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT * FROM tournament WHERE tournament_id = ?", [tournamentId]);
    const tournament = found(rows);
    // Crosstable-style standings: points per player over v_player_game, ranked with a window function.
    const [standings] = await connection.execute<RowDataPacket[]>(
      `SELECT v.player_id, p.name, p.title, p.federation, p.photo_url, MAX(v.player_elo) AS elo,
              COUNT(*) AS games, SUM(v.score) AS points, SUM(v.score = 1) AS wins, SUM(v.score = 0.5) AS draws,
              SUM(v.score = 0) AS losses, ROUND(AVG(v.opponent_elo)) AS avg_opponent_elo,
              SUM(v.color = 'w') AS white_games,
              RANK() OVER (ORDER BY SUM(v.score) DESC) AS place
       FROM v_player_game v JOIN player p ON p.player_id = v.player_id
       WHERE v.tournament_id = ? AND v.result <> '*'
       GROUP BY v.player_id, p.name, p.title, p.federation, p.photo_url
       ORDER BY points DESC, elo DESC, p.name`, [tournamentId],
    );
    const [openings] = await connection.execute<RowDataPacket[]>(
      `SELECT o.opening_id, o.eco, o.name, COUNT(*) AS games,
              SUM(g.result = '1-0') AS white_wins, SUM(g.result = '1/2-1/2') AS draws, SUM(g.result = '0-1') AS black_wins
       FROM game g JOIN opening o ON o.opening_id = g.opening_id
       WHERE g.tournament_id = ? GROUP BY o.opening_id, o.eco, o.name
       ORDER BY games DESC, o.eco LIMIT 12`, [tournamentId],
    );
    const [[summary]] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS games, SUM(result = '1-0') AS white_wins, SUM(result = '1/2-1/2') AS draws,
              SUM(result = '0-1') AS black_wins, COUNT(DISTINCT round_no) AS rounds,
              ROUND(AVG((white_elo + black_elo) / 2)) AS avg_elo
       FROM (SELECT g.*, SUBSTRING_INDEX(g.round, '.', 1) AS round_no FROM game g WHERE g.tournament_id = ?) x`, [tournamentId],
    );
    await connection.commit();
    return json({ ...tournament, summary, standings, openings });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
export async function PATCH(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const tournamentId = id.parse((await context.params).id);
    const patch = tournamentSchema.partial().refine(v => Object.keys(v).length > 0).parse(await body(request));
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [rows] = await connection.execute<TournamentRow[]>("SELECT * FROM tournament WHERE tournament_id = ? FOR UPDATE", [tournamentId]);
    const t = { ...found(rows), ...patch };
    await connection.execute("UPDATE tournament SET name = ?, date = ?, location = ? WHERE tournament_id = ?", [t.name, t.date, t.location, tournamentId]);
    await connection.commit();
    return json(t);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
export async function DELETE(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const tournamentId = id.parse((await context.params).id);
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT tournament_id FROM tournament WHERE tournament_id = ? FOR UPDATE", [tournamentId]);
    found(rows);
    await connection.execute("DELETE FROM tournament WHERE tournament_id = ?", [tournamentId]);
    await connection.commit();
    return json({ deleted: tournamentId });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
