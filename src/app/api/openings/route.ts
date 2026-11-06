import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { body, errorResponse, json, pagination } from "@/lib/http";
import { openingSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const connection = await getPool().getConnection();
  try {
    const { limit, offset } = pagination(request);
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT * FROM opening ORDER BY eco, opening_id LIMIT ? OFFSET ?", [String(limit), String(offset)]);
    await connection.commit();
    return json(rows);
  } catch (error) { await connection.rollback(); return errorResponse(error); }
  finally { connection.release(); }
}
export async function POST(request: Request) {
  const connection = await getPool().getConnection();
  try {
    const o = openingSchema.parse(await body(request));
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [result] = await connection.execute<ResultSetHeader>("INSERT INTO opening (eco, name) VALUES (?, ?)", [o.eco, o.name]);
    await connection.commit();
    return json({ opening_id: result.insertId, ...o }, 201);
  } catch (error) { await connection.rollback(); return errorResponse(error); }
  finally { connection.release(); }
}
