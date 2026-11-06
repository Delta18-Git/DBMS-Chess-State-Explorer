import { z } from "zod";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { body, errorResponse, found, id, json, type IdContext } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const repertoireId = id.parse((await context.params).id);
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT * FROM repertoire WHERE repertoire_id = ?", [repertoireId]);
    const repertoire = found(rows);
    const [lines] = await connection.execute<RowDataPacket[]>(
      `SELECT l.*, p.fen FROM repertoire_line l JOIN \`position\` p ON p.position_id = l.start_position_id
       WHERE l.repertoire_id = ? ORDER BY l.repertoire_line_id`, [repertoireId],
    );
    await connection.commit();
    return json({ ...repertoire, lines });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
export async function PATCH(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const repertoireId = id.parse((await context.params).id);
    const input = z.object({ name: z.string().trim().min(1).max(100) }).strict().parse(await body(request));
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT * FROM repertoire WHERE repertoire_id = ? FOR UPDATE", [repertoireId]);
    const repertoire = found(rows);
    await connection.execute("UPDATE repertoire SET name = ? WHERE repertoire_id = ?", [input.name, repertoireId]);
    await connection.commit();
    return json({ ...repertoire, name: input.name });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
export async function DELETE(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const repertoireId = id.parse((await context.params).id);
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT repertoire_id FROM repertoire WHERE repertoire_id = ? FOR UPDATE", [repertoireId]);
    found(rows);
    await connection.execute("DELETE FROM repertoire_line WHERE repertoire_id = ?", [repertoireId]);
    await connection.execute("DELETE FROM repertoire WHERE repertoire_id = ?", [repertoireId]);
    await connection.commit();
    return json({ deleted: repertoireId });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
