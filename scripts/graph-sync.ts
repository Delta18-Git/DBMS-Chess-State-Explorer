import mysql from "mysql2/promise";
import { dbOptions } from "../src/lib/db";
import { closeGraph, ensureGraphSchema } from "../src/lib/graph";
import { drainOutbox, rebuildGraph } from "../src/lib/graph-sync";

// npm run graph:sync      -> drain every pending outbox change into Neo4j
// npm run graph:rebuild   -> wipe and rebuild the whole graph from MySQL (idempotent)
async function main() {
  const rebuild = process.argv.includes("--rebuild");
  const connection = await mysql.createConnection(dbOptions());
  try {
    await ensureGraphSchema();
    if (rebuild) {
      await connection.beginTransaction();
      try { console.log("Rebuilt:", await rebuildGraph(connection)); await connection.commit(); }
      catch (error) { await connection.rollback(); throw error; }
      return;
    }
    let total = 0;
    while (true) {
      await connection.beginTransaction();
      try {
        const step = await drainOutbox(connection);
        await connection.commit();
        if (!step.processed) break;
        total += step.processed;
        console.log("Synced batch:", step);
      } catch (error) { await connection.rollback(); throw error; }
    }
    console.log(total ? `Done: ${total} outbox change(s) applied.` : "Graph already up to date.");
  } finally { await connection.end(); await closeGraph(); }
}
main().catch(error => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : "Graph sync failed");
  process.exitCode = 1;
});
