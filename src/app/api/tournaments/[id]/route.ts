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
    await connection.commit();
    return json(tournament);
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
