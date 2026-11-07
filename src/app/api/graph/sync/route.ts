import type { PoolConnection } from "mysql2/promise";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { drainOutbox, rebuildGraph } from "@/lib/graph-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const modeSchema = z.object({ mode: z.enum(["drain", "rebuild"]).default("drain") });

// Admin-only relay: drain pending outbox rows into Neo4j (default) or rebuild the graph from MySQL.
export async function POST(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const { mode } = modeSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const result = mode === "rebuild" ? await rebuildGraph(connection) : await drainOutbox(connection);
    await connection.commit();
    return json({ mode, ...result });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
