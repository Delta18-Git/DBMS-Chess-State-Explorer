import mysql from "mysql2/promise";

// Reuse the pool across Next.js development hot reloads; no ORM or transaction wrapper.
const globalDb = globalThis as unknown as { chessPool?: mysql.Pool };

export function dbOptions() {
  const { DB_HOST, DB_PORT = "3306", DB_NAME, DB_USER, DB_PASSWORD } = process.env;
  if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) {
    throw new Error("Set DB_HOST, DB_NAME, DB_USER and DB_PASSWORD in .env.local");
  }
  const port = Number(DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid DB_PORT");
  return {
    host: DB_HOST, port, database: DB_NAME, user: DB_USER, password: DB_PASSWORD,
    charset: "utf8mb4", timezone: "Z", dateStrings: true,
    supportBigNumbers: true, bigNumberStrings: true,
  };
}

export function getPool() {
  globalDb.chessPool ??= mysql.createPool({
    ...dbOptions(), connectionLimit: 10, waitForConnections: true, queueLimit: 100,
    connectTimeout: 10000, multipleStatements: false,
  });
  return globalDb.chessPool;
}
