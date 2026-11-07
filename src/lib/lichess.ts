import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiError } from "./http";

// Lichess public API client (no token needed): broadcast tournaments, their PGN, and FIDE
// player records. Responses for the bundled tournaments are cached in data/lichess/ so a fresh
// setup is offline and reproducible; anything not cached is fetched live (one request at a time,
// as Lichess asks of API clients). No database access lives here: routes own all SQL.

const BASE = "https://lichess.org";
const CACHE = join(process.cwd(), "data", "lichess");
const UA = "chess-state-explorer/1.0 (DBMS course project)";

export interface BroadcastTour {
  id: string; name: string; url: string; tier?: number; image?: string;
  dates?: number[]; info?: { format?: string; tc?: string; fideTC?: string; location?: string; website?: string };
}
export interface Broadcast { tour: BroadcastTour; rounds: { id: string; name: string; slug: string }[]; photos?: Record<string, { small?: string; medium?: string }> }
export interface FidePlayer { id: number; name: string; federation?: string; year?: number; title?: string; standard?: number }

/** Accepts a broadcast URL (tournament or round page) or a bare 8-character tournament id. */
export function broadcastId(input: string) {
  const s = input.trim();
  if (/^[A-Za-z0-9]{8}$/.test(s)) return s;
  const m = /lichess\.org\/broadcast\/([^/?#]+)\/(?:([^/?#]+)\/)?([A-Za-z0-9]{8})(?:\/([A-Za-z0-9]{8}))?/.exec(s);
  if (!m) throw new ApiError(400, "Paste a lichess.org/broadcast/… link or an 8-character broadcast id");
  // /broadcast/{slug}/{tourId}  or  /broadcast/{slug}/{roundSlug}/{roundId}[/{gameId}]
  return m[2] ? { round: m[3] } : m[3];
}

async function cached(name: string) {
  try { return await readFile(join(CACHE, name), "utf8"); } catch { return null; }
}
async function get(path: string, accept: string) {
  let response: Response;
  try {
    response = await fetch(BASE + path, { headers: { accept, "user-agent": UA }, signal: AbortSignal.timeout(30000) });
  } catch { throw new ApiError(502, "Could not reach lichess.org"); }
  if (response.status === 404) throw new ApiError(404, "Lichess has no such broadcast");
  if (response.status === 429) throw new ApiError(503, "Lichess rate limit reached; retry in a minute");
  if (!response.ok) throw new ApiError(502, `Lichess answered ${response.status}`);
  return response.text();
}

/** Resolves a round id to its tournament id via the round endpoint. */
async function tourOfRound(roundId: string) {
  const data = JSON.parse(await get(`/api/broadcast/-/-/${roundId}`, "application/json")) as { tour: { id: string } };
  return data.tour.id;
}

export async function loadBroadcast(input: string, { live = false } = {}) {
  const ref = broadcastId(input);
  const id = typeof ref === "string" ? ref : await tourOfRound(ref.round);
  const meta = (!live && await cached(`${id}.json`)) || await get(`/api/broadcast/${id}`, "application/json");
  const pgn = (!live && await cached(`${id}.pgn`)) || await get(`/api/broadcast/${id}.pgn`, "application/x-chess-pgn");
  return { id, broadcast: JSON.parse(meta) as Broadcast, pgn };
}

/** FIDE records by id: cache first, then the API (sequential, failures ignored). */
export async function fidePlayers(ids: number[], { live = false } = {}) {
  const out = new Map<number, FidePlayer>();
  const cache = JSON.parse((await cached("fide.json")) ?? "{}") as Record<string, FidePlayer>;
  for (const id of ids) {
    if (!live && cache[id]) { out.set(id, cache[id]); continue; }
    try { out.set(id, JSON.parse(await get(`/api/fide/player/${id}`, "application/json"))); } catch { /* optional enrichment */ }
  }
  return out;
}

/**
 * Player photos from Wikimedia Commons, found through Wikidata's FIDE-id property (P1440 → P18).
 * Lichess's own photo URLs only load on lichess.org, while Commons images are free to embed.
 * Cache first (data/lichess/photos.json), then two Wikidata API calls for the rest; failures ignored.
 */
export async function commonsPhotos(ids: number[], { live = false } = {}) {
  const out = new Map<number, string>();
  const cache = JSON.parse((await cached("photos.json")) ?? "{}") as Record<string, string>;
  const missing: number[] = [];
  for (const id of ids) { if (!live && cache[id]) out.set(id, cache[id]); else missing.push(id); }
  if (!missing.length) return out;
  const api = async (params: Record<string, string>) => {
    const r = await fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ ...params, format: "json" })}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
    return r.ok ? r.json() : null;
  };
  try {
    const qids: string[] = [];
    for (let i = 0; i < missing.length; i += 12) {
      const r = await api({ action: "query", list: "search", srlimit: "50", srsearch: `haswbstatement:${missing.slice(i, i + 12).map(f => `P1440=${f}`).join("|")}` });
      qids.push(...(r?.query?.search ?? []).map((h: { title: string }) => h.title));
    }
    for (let i = 0; i < qids.length; i += 50) {
      const r = await api({ action: "wbgetentities", ids: qids.slice(i, i + 50).join("|"), props: "claims" });
      for (const e of Object.values(r?.entities ?? {}) as { claims?: Record<string, { mainsnak: { datavalue?: { value: string } } }[]> }[]) {
        const fide = (e.claims?.P1440 ?? []).map(c => Number(c.mainsnak.datavalue?.value));
        const image = e.claims?.P18?.[0]?.mainsnak.datavalue?.value;
        for (const f of fide) if (image && missing.includes(f)) out.set(f, `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image.replaceAll(" ", "_"))}?width=240`);
      }
    }
  } catch { /* photos are optional */ }
  return out;
}

export type Headers = Record<string, string>;

/** Splits a multi-game PGN, drops {comments} (Lichess stacks [%eval]/[%clk] ones the strict parser rejects). */
export function splitPgn(text: string) {
  return text.replace(/\r/g, "").split(/\n\s*\n(?=\[Event )/).map(s => s.trim()).filter(Boolean).map(raw => {
    const headers: Headers = {};
    for (const m of raw.matchAll(/^\[(\w+) "([^"]*)"\]$/gm)) headers[m[1]] = m[2];
    return { headers, pgn: raw.replace(/\s*\{[^}]*\}/g, "").replace(/\s*\$\d+/g, "") };
  });
}

/** Armageddon and tiebreak games are blitz/rapid: kept out so every stored game is classical. */
export function isClassical(h: Headers) {
  return !/armageddon|tie-?break|blitz|rapid/i.test(`${h.BroadcastURL ?? ""} ${h.Round ?? ""}`);
}

export const pgnDate = (d?: string) => d && /^\d{4}\.\d{2}\.\d{2}$/.test(d) ? d.replaceAll(".", "-") : null;
export const isoDate = (ms?: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : null);
