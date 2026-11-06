import mysql from "mysql2/promise";
import { z } from "zod";
import { dbOptions } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";

async function main() {
  const email = z.email().max(254).parse(process.argv[2]).toLowerCase();
  const role = z.enum(["admin", "analyst"]).parse(process.argv[3]);
  const password = z.string().min(12).max(256).parse(process.env.BOOTSTRAP_PASSWORD);
  const hash = await hashPassword(password);
  const connection = await mysql.createConnection(dbOptions());
  try {
    await connection.execute("INSERT INTO app_user (email, password_hash, role) VALUES (?, ?, ?)", [email, hash, role]);
    console.log(`Created ${role} account: ${email}`);
  } finally { await connection.end(); }
}
main().catch(error => {
  console.error(error instanceof z.ZodError ? "Usage: BOOTSTRAP_PASSWORD=<12+ characters> npm run user:create -- <email> <admin|analyst>" : "Account creation failed; check configuration and duplicate email.");
  process.exitCode = 1;
});
