import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { readGraph } from "@/lib/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Graph size, structure and replication lag (pending outbox rows) side by side with MySQL counts.
export async function GET(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    await connection.query("START TRANSACTION READ ONLY");
    await authorize(connection, request);
    const [[sql]] = await connection.query<RowDataPacket[]>(
      `SELECT (SELECT COUNT(*) FROM \`position\`) AS positions,
              (SELECT COUNT(*) FROM v_move_edge) AS move_edges,
              (SELECT COUNT(*) FROM graph_outbox WHERE processed_at IS NULL) AS pending_changes,
              (SELECT MAX(processed_at) FROM graph_outbox) AS last_synced_at`,
    );
    await connection.commit();
    const graph = await readGraph(async tx => {
      const result = await tx.run(
        `MATCH (p:Position) WITH count(p) AS nodes
         OPTIONAL MATCH ()-[m:MOVE]->() WITH nodes, count(m) AS edges
         OPTIONAL MATCH (t:Position) WHERE COUNT { (t)<-[:MOVE]-() } >= 2
         WITH nodes, edges, count(t) AS transpositions
         OPTIONAL MATCH (b:Position) WHERE COUNT { (b)-[:MOVE]->() } >= 2
         RETURN nodes, edges, transpositions, count(b) AS branch_points`,
      );
      return result.records[0].toObject();
    });
    return json({ mysql: sql, graph });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
