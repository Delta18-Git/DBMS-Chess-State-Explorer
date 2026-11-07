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
      `SELECT r.*, p.name AS player_name, p.title AS player_title, p.photo_url AS player_photo,
              u.display_name AS owner_name, u.email AS owner_email,
              COUNT(l.repertoire_line_id) AS line_count, COUNT(*) OVER () AS total_rows
       FROM repertoire r JOIN player p ON p.player_id = r.player_id
       LEFT JOIN app_user u ON u.user_id = r.owner_user_id
       LEFT JOIN repertoire_line l ON l.repertoire_id = r.repertoire_id
       WHERE (? IS NULL OR r.player_id = ?)
       GROUP BY r.repertoire_id, p.name, p.title, p.photo_url, u.display_name, u.email
       ORDER BY r.repertoire_id DESC LIMIT ? OFFSET ?`, [playerId, playerId, String(limit), String(offset)],
    );
    await connection.commit();
    return json(rows);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}

// Any signed-in user may create a repertoire; it is owned by them (analysts edit only their own).
export async function POST(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const r = repertoireSchema.parse(await body(request));
    await connection.beginTransaction();
    const user = await authorize(connection, request);
    const [result] = await connection.execute<ResultSetHeader>(
      "INSERT INTO repertoire (player_id, name, color, owner_user_id) VALUES (?, ?, ?, ?)", [r.player_id, r.name, r.color, user.user_id],
    );
    await connection.commit();
    return json({ repertoire_id: result.insertId, ...r, owner_user_id: user.user_id }, 201);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
