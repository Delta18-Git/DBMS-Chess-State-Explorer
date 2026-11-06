import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const connection = await getPool().getConnection();
  try {
    await connection.query("START TRANSACTION READ ONLY");
    const user = await authorize(connection, request);
    await connection.commit();
    return json(user);
  } catch (error) { await connection.rollback(); return errorResponse(error); }
  finally { connection.release(); }
}
