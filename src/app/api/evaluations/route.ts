import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { body, errorResponse, id, json, pagination } from "@/lib/http";
import { evaluationSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const connection = await getPool().getConnection();
  try {
    const { limit, offset } = pagination(request);
    const params = new URL(request.url).searchParams;
    const positionId = params.has("position_id") ? id.parse(params.get("position_id")) : null;
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT * FROM evaluation WHERE (? IS NULL OR position_id = ?) ORDER BY evaluation_id DESC LIMIT ? OFFSET ?",
      [positionId, positionId, String(limit), String(offset)],
    );
    await connection.commit();
    return json(rows);
  } catch (error) { await connection.rollback(); return errorResponse(error); }
  finally { connection.release(); }
}
export async function POST(request: Request) {
  const connection = await getPool().getConnection();
  try {
    const e = evaluationSchema.parse(await body(request));
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [result] = await connection.execute<ResultSetHeader>("INSERT INTO evaluation (position_id, cp, depth) VALUES (?, ?, ?)", [e.position_id, e.cp, e.depth]);
    // trg_evaluation_insert records a JSON snapshot atomically with this INSERT.
    await connection.commit();
    return json({ evaluation_id: result.insertId, ...e }, 201);
  } catch (error) { await connection.rollback(); return errorResponse(error); }
  finally { connection.release(); }
}
