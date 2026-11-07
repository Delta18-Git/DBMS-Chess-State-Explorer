import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { Chess } from "chess.js";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { canonicalFen } from "@/lib/chess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Loads the Lichess opening catalogue (data/openings/*.tsv, CC0: eco, name, main line).
// Each line is replayed with chess.js, its final board is stored once in `position`, and the
// opening row points at it, so any stored board can be named ("Queen's Gambit Declined: …").
// Idempotent: existing (eco, name) rows only gain their line and position.
export async function POST(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const dir = join(process.cwd(), "data", "openings");
    const entries: { eco: string; name: string; pgn: string; fen: string }[] = [];
    for (const file of (await readdir(dir)).filter(f => f.endsWith(".tsv")).sort()) {
      for (const line of (await readFile(join(dir, file), "utf8")).split("\n").slice(1)) {
        const [eco, name, pgn] = line.split("\t");
        if (!eco || !name || !pgn || !/^[A-E]\d{2}$/.test(eco)) continue;
        const board = new Chess();
        try { board.loadPgn(pgn); } catch { continue; }
        entries.push({ eco, name: name.slice(0, 150), pgn: pgn.slice(0, 1000), fen: canonicalFen(board.fen()) });
      }
    }
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const fens = [...new Set(entries.map(e => e.fen))].sort();
    const ids = new Map<string, number>();
    for (let i = 0; i < fens.length; i += 500) {
      const batch = fens.slice(i, i + 500);
      await connection.execute(`INSERT INTO \`position\` (fen) VALUES ${batch.map(() => "(?)").join(",")} ON DUPLICATE KEY UPDATE position_id = position_id`, batch);
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT position_id, fen FROM \`position\` WHERE fen IN (${batch.map(() => "?").join(",")})`, batch);
      for (const r of rows) ids.set(r.fen, Number(r.position_id));
    }
    for (let i = 0; i < entries.length; i += 500) {
      const batch = entries.slice(i, i + 500);
      await connection.execute(
        `INSERT INTO opening (eco, name, pgn, position_id) VALUES ${batch.map(() => "(?, ?, ?, ?)").join(",")} AS new
         ON DUPLICATE KEY UPDATE pgn = COALESCE(opening.pgn, new.pgn), position_id = COALESCE(opening.position_id, new.position_id)`,
        batch.flatMap(e => [e.eco, e.name, e.pgn, ids.get(e.fen)!]),
      );
    }
    const [[count]] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS named FROM opening WHERE position_id IS NOT NULL");
    await connection.commit();
    return json({ catalogue_lines: entries.length, boards: fens.length, named_openings: Number(count.named) }, 201);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
