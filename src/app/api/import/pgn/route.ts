import type { PoolConnection } from "mysql2/promise";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { ApiError, body, errorResponse, foreignId, json } from "@/lib/http";
import { importGames } from "@/lib/importer";
import { splitPgn } from "@/lib/lichess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ pgn: z.string().trim().min(1).max(120000), tournament_id: foreignId.nullable().default(null) }).strict();

// Paste one or many PGN games. Players, event and opening are read from the headers and matched
// to stored rows (or created); everything commits in ONE transaction or not at all.
export async function POST(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const input = schema.parse(await body(request));
    const games = splitPgn(input.pgn.startsWith("[") ? input.pgn : `[Event "?"]\n\n${input.pgn}`);
    if (!games.length) throw new ApiError(400, "No games found in the PGN");
    if (games.length > 200) throw new ApiError(400, "Import at most 200 games at a time");
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const result = await importGames(connection, games, { tournamentId: input.tournament_id });
    if (!result.imported && result.failed.length) throw new ApiError(400, `No game imported: ${result.failed[0].error}`);
    await connection.commit();
    return json(result, 201);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
