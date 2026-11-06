import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { canonicalFen } from "@/lib/chess";
import { body, errorResponse, json, pagination } from "@/lib/http";
import { positionSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const { limit, offset } = pagination(request);
    const queryFen = new URL(request.url).searchParams.get("fen");
    const fen = queryFen === null ? null : canonicalFen(queryFen);
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT * FROM `position` WHERE (? IS NULL OR fen = ?) ORDER BY position_id LIMIT ? OFFSET ?",
      [fen, fen, String(limit), String(offset)],
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
    const input = positionSchema.parse(await body(request));
    const fen = canonicalFen(input.fen);
    const [result] = await connection.execute<ResultSetHeader>("INSERT INTO `position` (fen, comment) VALUES (?, ?)", [fen, input.comment]);
    await connection.commit();
    return json({ position_id: result.insertId, fen, comment: input.comment }, 201);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
