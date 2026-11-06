import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { body, errorResponse, found, id, json, type IdContext } from "@/lib/http";
import { playerSchema } from "@/lib/validation";
import type { PlayerRow } from "@/lib/rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: IdContext) {
  const connection = await getPool().getConnection();
  try {
    const playerId = id.parse((await context.params).id);
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT * FROM player WHERE player_id = ?", [playerId]);
    const player = found(rows);
    await connection.commit();
    return json(player);
  } catch (error) { await connection.rollback(); return errorResponse(error); }
  finally { connection.release(); }
}

export async function PATCH(request: Request, context: IdContext) {
  const connection = await getPool().getConnection();
  try {
    const playerId = id.parse((await context.params).id);
    const patch = playerSchema.partial().refine(v => Object.keys(v).length > 0).parse(await body(request));
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [rows] = await connection.execute<PlayerRow[]>("SELECT * FROM player WHERE player_id = ? FOR UPDATE", [playerId]);
    const p = { ...found(rows), ...patch };
    await connection.execute("UPDATE player SET name = ?, title = ?, federation = ?, birth_year = ?, rating = ? WHERE player_id = ?",
      [p.name, p.title, p.federation, p.birth_year, p.rating, playerId]);
    await connection.commit();
    return json(p);
  } catch (error) { await connection.rollback(); return errorResponse(error); }
  finally { connection.release(); }
}

export async function DELETE(request: Request, context: IdContext) {
  const connection = await getPool().getConnection();
  try {
    const playerId = id.parse((await context.params).id);
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT player_id FROM player WHERE player_id = ? FOR UPDATE", [playerId]);
    found(rows);
    await connection.execute("DELETE FROM player WHERE player_id = ?", [playerId]);
    await connection.commit();
    return json({ deleted: playerId });
  } catch (error) { await connection.rollback(); return errorResponse(error); }
  finally { connection.release(); }
}
