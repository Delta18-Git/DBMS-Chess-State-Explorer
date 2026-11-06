import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { ApiError } from "./http";

const scrypt = promisify(scryptCallback);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, hex] = encoded.split(":");
  if (algorithm !== "scrypt" || !/^[a-f0-9]{32}$/.test(salt ?? "") || !/^[a-f0-9]{128}$/.test(hex ?? "")) return false;
  const candidate = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(candidate, Buffer.from(hex, "hex"));
}
export function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function newToken() { return randomBytes(32).toString("hex"); }
export function bearer(request: Request) {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new ApiError(401, "Valid Bearer token required");
  return match[1];
}
export interface AuthUser extends RowDataPacket { user_id: number; email: string; role: "admin" | "analyst" }

// Only authentication SQL is shared; all domain SQL and transaction boundaries live in route.ts.
export async function authorize(connection: PoolConnection, request: Request, role?: "admin") {
  const [users] = await connection.execute<AuthUser[]>(
    `SELECT u.user_id, u.email, u.role FROM api_session s
     JOIN app_user u ON u.user_id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()`, [tokenHash(bearer(request))],
  );
  if (!users.length) throw new ApiError(401, "Session expired or invalid");
  if (role && users[0].role !== role) throw new ApiError(403, "Admin role required");
  return users[0];
}
