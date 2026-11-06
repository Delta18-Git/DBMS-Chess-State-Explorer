import { z } from "zod";
import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { body, errorResponse, found, id, json, type IdContext } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: IdContext) {
  const connection = await getPool().getConnection();
  try {
    const positionId = id.parse((await context.params).id);
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT p.*, e.evaluation_id, e.cp, e.depth FROM \`position\` p
       LEFT JOIN v_latest_evaluation e ON e.position_id = p.position_id WHERE p.position_id = ?`, [positionId],
    );
    const position = found(rows);
    await connection.commit();
    return json(position);
  } catch (error) { await connection.rollback(); return errorResponse(error); }
  finally { connection.release(); }
}
export async function PATCH(request: Request, context: IdContext) {
  const connection = await getPool().getConnection();
  try {
    const positionId = id.parse((await context.params).id);
    const input = z.object({ comment: z.string().max(10000).nullable() }).strict().parse(await body(request));
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT * FROM `position` WHERE position_id = ? FOR UPDATE", [positionId]);
    const position = found(rows);
    await connection.execute("UPDATE `position` SET comment = ? WHERE position_id = ?", [input.comment, positionId]);
    await connection.commit();
    return json({ ...position, comment: input.comment });
  } catch (error) { await connection.rollback(); return errorResponse(error); }
  finally { connection.release(); }
}
export async function DELETE(request: Request, context: IdContext) {
  const connection = await getPool().getConnection();
  try {
    const positionId = id.parse((await context.params).id);
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT position_id FROM `position` WHERE position_id = ? FOR UPDATE", [positionId]);
    found(rows);
    await connection.execute("DELETE FROM `position` WHERE position_id = ?", [positionId]);
    await connection.commit();
    return json({ deleted: positionId });
  } catch (error) { await connection.rollback(); return errorResponse(error); }
  finally { connection.release(); }
}
