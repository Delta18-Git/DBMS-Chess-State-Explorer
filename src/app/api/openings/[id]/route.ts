import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { body, errorResponse, found, id, json, type IdContext } from "@/lib/http";
import { openingSchema } from "@/lib/validation";
import type { OpeningRow } from "@/lib/rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const openingId = id.parse((await context.params).id);
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT * FROM opening WHERE opening_id = ?", [openingId]);
    const opening = found(rows);
    await connection.commit();
    return json(opening);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
export async function PATCH(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const openingId = id.parse((await context.params).id);
    const patch = openingSchema.partial().refine(v => Object.keys(v).length > 0).parse(await body(request));
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [rows] = await connection.execute<OpeningRow[]>("SELECT * FROM opening WHERE opening_id = ? FOR UPDATE", [openingId]);
    const o = { ...found(rows), ...patch };
    await connection.execute("UPDATE opening SET eco = ?, name = ? WHERE opening_id = ?", [o.eco, o.name, openingId]);
    await connection.commit();
    return json(o);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
export async function DELETE(request: Request, context: IdContext) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const openingId = id.parse((await context.params).id);
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT opening_id FROM opening WHERE opening_id = ? FOR UPDATE", [openingId]);
    found(rows);
    await connection.execute("DELETE FROM opening WHERE opening_id = ?", [openingId]);
    await connection.commit();
    return json({ deleted: openingId });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
