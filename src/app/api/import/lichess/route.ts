import type { PoolConnection } from "mysql2/promise";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { authorize } from "@/lib/auth";
import { ApiError, body, errorResponse, json } from "@/lib/http";
import { importGames } from "@/lib/importer";
import { commonsPhotos, fidePlayers, isClassical, isoDate, loadBroadcast, splitPgn } from "@/lib/lichess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ source: z.string().trim().min(8).max(300), live: z.boolean().default(false) }).strict();

// Imports a whole Lichess broadcast tournament: metadata from the broadcast API, players enriched
// from Lichess's FIDE API (photos from Wikimedia Commons via Wikidata), then every classical game in one MySQL transaction. Re-running it only
// adds games that were not imported yet (game.source_url is UNIQUE).
export async function POST(request: Request) {
  let connection: PoolConnection | undefined;
  try {
    connection = await getPool().getConnection();
    const input = schema.parse(await body(request));
    // Authorize before any outbound request; never hold row locks while waiting on the network.
    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    await connection.commit();

    const { broadcast, pgn } = await loadBroadcast(input.source, { live: input.live });
    const games = splitPgn(pgn).filter(g => isClassical(g.headers) && g.headers.Result !== "*");
    if (!games.length) throw new ApiError(400, "This broadcast has no finished classical games yet");
    const fideIds = [...new Set(games.flatMap(g => [g.headers.WhiteFideId, g.headers.BlackFideId]).map(Number).filter(n => n > 0))];
    const [fide, photos] = await Promise.all([fidePlayers(fideIds, { live: input.live }), commonsPhotos(fideIds)]);
    const { tour } = broadcast;

    await connection.beginTransaction();
    await authorize(connection, request, "admin");
    const result = await importGames(connection, games, {
      tournament: {
        name: tour.name, date: isoDate(tour.dates?.[0]), end_date: isoDate(tour.dates?.[1] ?? tour.dates?.[0]),
        location: tour.info?.location ?? null, format: tour.info?.format ?? null, time_control: tour.info?.tc ?? null,
        source_url: tour.url, image_url: null, // Lichess images only load on lichess.org
      },
      fide, photos,
    });
    await connection.commit();
    return json({ ...result, tournament: tour.name }, 201);
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch { connection.destroy(); } }
    return errorResponse(error);
  } finally { connection?.release(); }
}
