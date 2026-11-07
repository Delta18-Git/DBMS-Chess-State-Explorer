import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// The web UI is just another client of the /api route handlers: every read and write goes
// through the same validation, authorization and transactions as any HTTP caller.
// The bearer token lives in an HttpOnly, SameSite=Strict cookie and never reaches browser JS.

export const SESSION_COOKIE = "cse_session";
// Fixed, server-side base URL (never derived from the request's Host header, which a client controls).
const API_BASE = (process.env.INTERNAL_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`).replace(/\/$/, "") + "/api";

export class ApiFailure extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type Role = "admin" | "analyst";
export interface SessionUser { user_id: number; email: string; display_name: string | null; role: Role }

async function token() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

async function call<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const t = auth ? await token() : undefined;
  if (auth && !t) redirect("/login");
  const response = await fetch(API_BASE + path, {
    ...init, cache: "no-store",
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(t ? { authorization: `Bearer ${t}` } : {}), ...init.headers },
  });
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } };
  if (response.status === 401 && auth) redirect("/login?expired=1");
  if (!response.ok) throw new ApiFailure(response.status, payload.error?.message ?? `Request failed (${response.status})`);
  return payload.data as T;
}

/** GET /api{path}; redirects to /login if the session is missing or expired. */
export function apiGet<T = any>(path: string) { return call<T>(path); }

/** Same as apiGet but resolves to null on 404 (for detail pages). */
export async function apiFind<T = any>(path: string) {
  try { return await call<T>(path); } catch (e) { if (e instanceof ApiFailure && e.status === 404) return null; throw e; }
}

export function apiSend<T = any>(path: string, method: "POST" | "PATCH" | "DELETE", data?: unknown) {
  return call<T>(path, { method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}

export function apiPublic<T = any>(path: string, data: unknown) {
  return call<T>(path, { method: "POST", body: JSON.stringify(data) }, false);
}

/** The signed-in user, memoised per request. */
export const currentUser = cache(async () => apiGet<SessionUser>("/auth/me"));

export function qs(params: Record<string, string | number | null | undefined>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

/** Every row of a paginated collection (API max page size is 100), capped for safety. */
export async function apiAll<T = any>(path: string, cap = 2000) {
  const rows: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let offset = 0; offset < cap; offset += 100) {
    const page = await apiGet<T[]>(`${path}${sep}limit=100&offset=${offset}`);
    rows.push(...page);
    if (page.length < 100) break;
  }
  return rows;
}
