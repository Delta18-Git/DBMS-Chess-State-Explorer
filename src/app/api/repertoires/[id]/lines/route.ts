import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { legalSan } from "@/lib/chess";
import { body, errorResponse, found, id, json, type IdContext } from "@/lib/http";
import { lineSchema } from "@/lib/validation";

export const runtime = "nodejs";
export async function POST(request: Request, context: IdContext) {
  const connection = await getPool().getConnection();
  try {
    const repertoireId = id.parse((await context.params).id);
    const input = lineSchema.parse(await body(request));
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [repertoires] = await connection.execute<RowDataPacket[]>("SELECT repertoire_id FROM repertoire WHERE repertoire_id = ? FOR UPDATE", [repertoireId]);
    found(repertoires);
    const [positions] = await connection.execute<RowDataPacket[]>("SELECT fen FROM `position` WHERE position_id = ? FOR SHARE", [input.start_position_id]);
    const position = found(positions);
    const move = legalSan(position.fen, input.move_san);
    const [result] = await connection.execute<ResultSetHeader>(
      "INSERT INTO repertoire_line (repertoire_id, start_position_id, move_san) VALUES (?, ?, ?)", [repertoireId, input.start_position_id, move],
    );
    await connection.commit();
    return json({ repertoire_line_id: result.insertId, repertoire_id: repertoireId, start_position_id: input.start_position_id, move_san: move }, 201);
  } catch (error) { await connection.rollback(); return errorResponse(error); }
  finally { connection.release(); }
}
