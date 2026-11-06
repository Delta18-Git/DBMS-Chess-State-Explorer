import { z } from "zod";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function json(data: unknown, status = 200) {
  return Response.json({ data }, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorResponse(error: unknown) {
  let status = 500;
  let message = "Internal server error";
  if (error instanceof ApiError) { status = error.status; message = error.message; }
  else if (error instanceof z.ZodError) { status = 400; message = error.issues.map(i => `${i.path.join(".") || "input"}: ${i.message}`).join("; "); }
  else if (error instanceof SyntaxError) { status = 400; message = "Invalid JSON"; }
  else {
    const code = (error as { code?: string })?.code;
    if (code === "ER_DUP_ENTRY") { status = 409; message = "Resource already exists"; }
    else if (code === "ER_ROW_IS_REFERENCED_2") { status = 409; message = "Resource is still referenced; remove dependants first"; }
    else if (code === "ER_NO_REFERENCED_ROW_2") { status = 422; message = "A referenced resource does not exist"; }
    else if (["ER_CHECK_CONSTRAINT_VIOLATED", "ER_WARN_DATA_OUT_OF_RANGE", "ER_DATA_TOO_LONG", "WARN_DATA_TRUNCATED"].includes(code ?? "")) { status = 400; message = "Database constraint rejected the input"; }
    else if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(code ?? "")) { status = 409; message = "Concurrent change; retry the request"; }
    // Log only an error code/name: driver errors can contain SQL parameters or secrets.
    else console.error("API failure:", code ?? (error instanceof Error ? error.name : "unknown"));
  }
  return Response.json({ error: { message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function body(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) throw new ApiError(415, "Use application/json");
  // Bound chunked requests too, rather than trusting Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "JSON body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 131072) { await reader.cancel(); throw new ApiError(413, "Body exceeds 128 KiB"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export const id = z.coerce.number().int().positive().max(4294967295);
export const foreignId = z.number().int().positive().max(4294967295);
export const date = z.iso.date();
export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
});
export function pagination(request: Request) {
  return pageSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
}
export type IdContext = { params: Promise<{ id: string }> };
export function found<T>(rows: T[]) {
  if (!rows.length) throw new ApiError(404, "Resource not found");
  return rows[0];
}
