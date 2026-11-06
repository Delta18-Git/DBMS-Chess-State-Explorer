import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { body, errorResponse, id, json, pagination } from "@/lib/http";
import { repertoireSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const { limit, offset } = pagination(request);
    const params = new URL(request.url).searchParams;
    const playerId = params.has("player_id") ? id.parse(params.get("player_id")) : null;
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT r.*, p.name AS player_name, COUNT(l.repertoire_line_id) AS line_count
       FROM repertoire r JOIN player p ON p.player_id = r.player_id
       LEFT JOIN repertoire_line l ON l.repertoire_id = r.repertoire_id
       WHERE (? IS NULL OR r.player_id = ?) GROUP BY r.repertoire_id, p.name
       ORDER BY r.repertoire_id LIMIT ? OFFSET ?`, [playerId, playerId, String(limit), String(offset)],
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
    const r = repertoireSchema.parse(await body(request));
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [result] = await connection.execute<ResultSetHeader>("INSERT INTO repertoire (player_id, name) VALUES (?, ?)", [r.player_id, r.name]);
    await connection.commit();
    return json({ repertoire_id: result.insertId, ...r }, 201);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
