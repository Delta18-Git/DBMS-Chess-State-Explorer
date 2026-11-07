import { readdir, readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { dbOptions } from "../src/lib/db";

// Applies database/migrations/*.sql in name order, exactly once each.
// MySQL DDL implicitly commits, so a migration is recorded only after it fully succeeds;
// a failed migration must be inspected by hand, never blindly re-run.
export async function migrate(connection: mysql.Connection) {
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migration (
    name VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  const [done] = await connection.query<mysql.RowDataPacket[]>("SELECT name FROM schema_migration");
  const applied = new Set(done.map(row => row.name as string));
  const dir = new URL("../database/migrations/", import.meta.url);
  const files = (await readdir(dir)).filter(f => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    await connection.query(await readFile(new URL(file, dir), "utf8"));
    await connection.execute("INSERT INTO schema_migration (name) VALUES (?)", [file]);
    ran.push(file);
  }
  return ran;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const connection = await mysql.createConnection({ ...dbOptions(), multipleStatements: true });
    try {
      const ran = await migrate(connection);
      console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Database is up to date.");
    } finally { await connection.end(); }
  })().catch(error => { console.error(error instanceof Error ? error.message : "Migration failed"); process.exitCode = 1; });
}
