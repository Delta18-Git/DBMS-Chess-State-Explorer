import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { dbOptions } from "../src/lib/db";
import { migrate } from "./migrate-db";

async function main() {
  const connection = await mysql.createConnection({ ...dbOptions(), multipleStatements: true });
  try {
    const [tables] = await connection.query<mysql.RowDataPacket[]>("SHOW TABLES");
    if (tables.length) throw new Error("Database is not empty. Refusing to overwrite existing work; use a new database.");
    // MySQL DDL implicitly commits: never pretend initialization is rollback-safe.
    await connection.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
    await connection.beginTransaction();
    try {
      await connection.query(await readFile(new URL("../database/seed.sql", import.meta.url), "utf8"));
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    const ran = await migrate(connection);
    console.log(`Schema, views, procedure, triggers and sample metadata initialized; migrations: ${ran.join(", ") || "none"}.`);
  } finally { await connection.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Initialization failed"); process.exitCode = 1; });
