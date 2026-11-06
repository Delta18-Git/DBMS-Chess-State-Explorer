import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { body, errorResponse, json, pagination } from "@/lib/http";
import { playerSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const { limit, offset } = pagination(request);
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT * FROM player ORDER BY player_id LIMIT ? OFFSET ?", [String(limit), String(offset)]);
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
    const p = { title: null, federation: null, birth_year: null, rating: null, ...playerSchema.parse(await body(request)) };
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [result] = await connection.execute<ResultSetHeader>(
      "INSERT INTO player (name, title, federation, birth_year, rating) VALUES (?, ?, ?, ?, ?)",
      [p.name, p.title, p.federation, p.birth_year, p.rating],
    );
    await connection.commit();
    return json({ player_id: result.insertId, ...p }, 201);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
