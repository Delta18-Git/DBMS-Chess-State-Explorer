import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Serves the browser build of Stockfish 19 (lite, single-threaded WebAssembly, ~1.7 MB) straight
// from node_modules/stockfish, so the engine ships with the app and needs no install or copy step.
// Static, public, cacheable; not a database route.
const FILES: Record<string, string> = {
  "stockfish-19-lite-single.js": "stockfish-19-lite-single.js",
  // The worker derives the .wasm URL from its own file name (or asks for "stockfish.wasm").
  "stockfish-19-lite-single.wasm": "stockfish-19-lite-single.wasm",
  "stockfish.wasm": "stockfish-19-lite-single.wasm",
};

export async function GET(_: Request, context: { params: Promise<{ file: string }> }) {
  const name = FILES[(await context.params).file];
  if (!name) return new Response("Not found", { status: 404 });
  const bytes = await readFile(join(process.cwd(), "node_modules", "stockfish", "bin", name));
  return new Response(bytes, {
    headers: {
      "content-type": name.endsWith(".wasm") ? "application/wasm" : "text/javascript",
      "cache-control": "public, max-age=604800, immutable",
    },
  });
}
